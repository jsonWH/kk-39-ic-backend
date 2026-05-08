"""
KK39 IC Paper Generator — Backend Server
Handles: PDF text extraction, image extraction, Claude API calls, docx generation
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import anthropic
import fitz  # pymupdf
import json, os, tempfile, shutil, base64
from pathlib import Path
from generate_docx import generate_docx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# ── Helpers ────────────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: str) -> str:
    """Extract all text from a PDF."""
    doc = fitz.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text()
    return text

def extract_pdf_images(pdf_path: str, out_dir: str) -> list:
    """Extract and classify images from PDF."""
    doc = fitz.open(pdf_path)
    images = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        for img_idx, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            base = doc.extract_image(xref)
            w, h = base["width"], base["height"]
            if w < 80 or h < 80:
                continue
            ext = base["ext"]
            fname = f"p{page_num+1}_i{img_idx}.{ext}"
            fpath = os.path.join(out_dir, fname)
            with open(fpath, "wb") as f:
                f.write(base["image"])
            ratio = h / w if w else 1
            if 0.8 <= ratio <= 1.3 and 100 <= w <= 500:
                itype = "headshot"
            elif ratio < 0.65 and w > 600:
                itype = "fund_structure"
            elif ratio > 1.2 and w > 800:
                itype = "portfolio_table"
            elif 0.4 <= ratio <= 0.8 and w > 700:
                itype = "chart"
            else:
                itype = "other"
            images.append({"path": fpath, "page": page_num+1,
                           "type": itype, "w": w, "h": h, "ext": ext})
    return images

def call_claude(system: str, prompt: str, pdf_texts: list[str]) -> str:
    """Call Claude API with text content."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    combined_text = "\n\n---NEW DOCUMENT---\n\n".join(pdf_texts)
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": f"{combined_text}\n\n---\n\n{prompt}"}]
    )
    return response.content[0].text

SYSTEM_PROMPT = """You are a senior investment analyst at KK39 Ventures, a Singapore-based investment firm.
You write rigorous, opinionated investment committee (IC) papers for fund investments.

Your writing style:
- Analytical and opinionated — use phrases like "we are confident", "KK39 notes", "we view"
- Specific and evidence-driven — reference exact figures, dates, and names from the documents
- Flowing prose paragraphs — no bullet points unless for a list of items
- Use **bold** for sub-section headings within a section
- For tables, use markdown pipe format: | Col1 | Col2 |
- KK39's house style is clean and institutional — not dry, but precise

IMPORTANT: Write in flowing paragraphs. Tables should use | pipe | markdown | format |.
Do not add preamble or meta-commentary. Start directly with the content."""

# ── Main generation endpoint ───────────────────────────────────────────────

@app.post("/generate")
async def generate(
    files: list[UploadFile] = File(...),
    meta: str = Form(...),
    scores: str = Form(...),
):
    meta_data = json.loads(meta)
    scores_data = json.loads(scores)

    tmp_dir = tempfile.mkdtemp()
    img_dir = os.path.join(tmp_dir, "images")
    os.makedirs(img_dir)

    try:
        # Save uploaded PDFs and extract content
        pdf_texts = []
        all_images = []
        for file in files:
            pdf_path = os.path.join(tmp_dir, file.filename)
            with open(pdf_path, "wb") as f:
                shutil.copyfileobj(file.file, f)
            pdf_texts.append(extract_pdf_text(pdf_path))
            all_images.extend(extract_pdf_images(pdf_path, img_dir))

        score_context = f"""
Investment details:
- Fund: {meta_data['fundName']}
- Proposed allocation: {meta_data['allocation']} ({meta_data['currency']})
- Written by: {meta_data['writtenBy']}
- Endorsed by: {meta_data['endorsedBy']}
- Date: {meta_data['submissionDate']}
{f"- Additional context: {meta_data['additionalContext']}" if meta_data.get('additionalContext') else ''}

KK39 Scoring (use these exact scores):
P1A Sector Trajectory: {scores_data['p1a']}/5.0
P1B Sector Resilience: {scores_data['p1b']}/5.0
P2A Management Team: {scores_data['p2a']}/5.0
P2B Fund Size Track Record: {scores_data['p2b']}/5.0
P2C Investment Track Record: {scores_data['p2c']}/5.0
P2D Operational Value-Add: {scores_data['p2d']}/5.0
P3A Fund Strategy: {scores_data['p3a']}/5.0
P3B Fundraising & LP Quality: {scores_data['p3b']}/5.0
P3C IC Process & Structure: {scores_data['p3c']}/5.0
P3D Deal Sourcing: {scores_data['p3d']}/5.0
P4A Fund Terms: {scores_data['p4a']}/5.0
P4B LP Protections: {scores_data['p4b']}/5.0"""

        # Generate each section
        sections = {}
        section_prompts = {
            "exec_summary_opportunity": "Write ONE tight paragraph (4-5 sentences) summarising the fund's core opportunity — what it is, who runs it, what it targets, and why now. This is for EXCO. Be specific with fund size, strategy type, and current raise amount.",
            "exec_summary_management": "Write ONE tight paragraph (3-4 sentences) summarising the founding team — names, titles, most relevant prior experience, and GP commitment. For EXCO.",
            "exec_summary_fund": "Write ONE tight paragraph (3-4 sentences) summarising the fund structure, fee terms, lock-up, and target returns. For EXCO. Be specific with numbers.",
            "exec_summary_track_record": "Write ONE tight paragraph (3-4 sentences) summarising the fund's inception-to-date performance versus benchmarks, and any notable portfolio company results. For EXCO.",
            "exec_summary_value_prop": "Write a markdown table with 2 columns (Pillar | Summary) and 5-6 rows covering the key reasons to invest. Each summary should be 1-2 sentences. Use: Pedigree, Performance, Structure, Fees, Alpha, Access as pillar names.",
            "exec_summary_dd": "Write ONE tight paragraph (3-4 sentences) summarising the DD process — what was reviewed, how many meetings, how many reference calls, and the headline conclusion. For EXCO.",
            "opportunity": f"{score_context}\n\nWrite Section 1 — The Opportunity. Cover: (a) why this fund represents a compelling opportunity in 2 paragraphs, (b) **About [Fund Name]** sub-section: AUM, structure, geography, strategy overview, (c) the current raise amount, purpose, and closing timeline. Write in flowing paragraphs. Include all specific figures from the documents. 500-600 words.",
            "management": f"{score_context}\n\nWrite Section 2 — Management Team. Cover each key person with **Name — Title** sub-headings: background, years of experience, specific prior firms and roles, relevant achievements. Then include a summary table: | Name | Title | Prior Firm | Total Experience |. End with a note on GP commitment. Write in flowing paragraphs between headings. 500-600 words.",
            "fund": f"{score_context}\n\nWrite Section 3 — The Fund. Include: (a) Opening paragraph on the fund's raise history and current round purpose, (b) **Fund Terms** table with all key terms, (c) **Investment Strategy & Themes** with 3 numbered sub-themes as **Theme I/II/III:** headings, each 100-150 words of analytical depth, (d) **Portfolio Construction** with target allocation table. 700-900 words.",
            "track_record": f"{score_context}\n\nWrite Section 4 — Track Record. Cover: (a) **Founder Track Record** — prior institutional record with specific figures, (b) **Fund Performance** table showing fund vs benchmarks across time periods, (c) **Notable Portfolio Companies** table with company name, type, value-add, and results columns. Be specific with all IRR, MOIC, and EBITDA figures from the documents. 500-600 words.",
            "value_prop": f"{score_context}\n\nWrite Section 5 — Value Proposition. Write 5-6 sub-sections, each with a **Bold Header** (3-5 words) followed by 3-4 sentences of analytical commentary. Cover: pedigree, performance, structure advantage, fee alignment, alpha generation, and access/differentiation. Use KK39's opinionated voice throughout. 500-600 words.",
            "due_diligence": f"{score_context}\n\nWrite Section 6 — Due Diligence. Cover: (a) Opening paragraph describing the overall DD process and scope, (b) **Document Review** sub-section listing what was reviewed, (c) **Meetings with Fund Team** table: | Date | Attendees | Topics Covered |, (d) **Reference Calls** table: | Party | Date | Key Themes | — each key themes cell should have 2-3 specific points from the call. 500-600 words.",
            "legal": f"{score_context}\n\nWrite Section 7 — Legal. Opening sentence assessing the terms overall. Then a comprehensive table: | Term | Section Reference | Description | covering all key LPA terms including: effective date, fund life, management fee (with exact structure), performance fee/carry, hurdle rate, lock-up, liquidity/redemptions, minimum subscription, key person provisions, GP removal threshold, co-investment rights, governing law, administrator, auditor. 400-500 words.",
            "recommendation": f"{score_context}\n\nWrite Section 8 — Final Recommendation. State clearly that KK39 recommends (or does not recommend) the investment of [{meta_data['allocation']}] into [{meta_data['fundName']}]. Give 3-4 specific reasons. Note any conditions or key risks to monitor. End with: 'This paper was written by {meta_data['writtenBy']} and endorsed by {meta_data['endorsedBy']}. The paper was submitted via email to the Investment Committee on {meta_data['submissionDate']}.' 250-300 words.",
        }

        for key, prompt in section_prompts.items():
            sections[key] = call_claude(SYSTEM_PROMPT, prompt, pdf_texts)

        # Generate scoring opinions
        scoring_opinions_prompt = f"""Based on the fund documents and these scores:
{score_context}

Write exactly 4 short analytical sentences (one per pillar) for the scoring table's opinion column.
Format as JSON with keys p1, p2, p3, p4.
Each value should be 1-2 sentences max, analytical, and reference specific evidence.
Return ONLY valid JSON, no other text."""

        opinions_raw = call_claude(SYSTEM_PROMPT, scoring_opinions_prompt, pdf_texts)
        try:
            clean = opinions_raw.strip().replace("```json","").replace("```","").strip()
            scoring_opinions = json.loads(clean)
        except:
            scoring_opinions = {}

        # Build data package for docx generator
        data = {
            "meta": meta_data,
            "scores": scores_data,
            "scoringOpinions": scoring_opinions,
            "images": all_images,
            "sections": sections,
        }

        # Generate docx
        out_path = os.path.join(tmp_dir, "ic_paper.docx")
        generate_docx(data, out_path)

        # Return the file
        fund_name = meta_data.get("fundName", "IC_Paper").replace(" ", "_").replace(",","")[:40]
        return FileResponse(
            out_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"{fund_name}_IC_Paper.docx",
            background=None
        )

    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}
