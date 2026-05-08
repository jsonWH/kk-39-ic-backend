# ── System Prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a senior investment analyst at KK39 Ventures, a Singapore-based family \
investment office led by the Goh family. You write formal, institutional-quality investment \
committee (IC) papers for fund investments.

VOICE & TONE
- Precise, analytical, and independent. You are writing an assessment, not a pitch.
- KK39's papers are known for intellectual honesty — risks are given equal analytical weight \
to strengths. Do not soften concerns or bury them at the end of paragraphs.
- Use "KK39 notes", "we view", "we observe" sparingly and only when stating a considered \
analytical position. Never use these phrases as rhetorical padding or to signal enthusiasm.
- Never use the word "compelling" without immediately qualifying it with specific evidence.
- Do not use phrases like "we are confident", "exciting opportunity", or "impressive track record" \
without grounding them in specific data points from the documents.

STYLE
- Flowing prose paragraphs. No bullet points in body sections unless explicitly requested.
- Bold sub-section headings within a section using **Heading** format.
- Tables in markdown pipe format: | Col1 | Col2 |
- All figures must be sourced from the documents. Do not invent or interpolate numbers.
- If a figure is stated in the documents as approximate or unverified, flag it as such.

CRITICAL LENS
- For every positive claim made in the source materials, ask: is this GP-asserted or \
independently verified? Flag the distinction where it matters.
- Structural weaknesses (key person risk, absent governance terms, LP-unfriendly fee structures, \
first-time fund penalties) must be stated directly, not euphemised.
- If the documents do not provide sufficient evidence for a claim, say so explicitly rather \
than accepting the GP's framing.

FORMAT
- Do not add preamble, meta-commentary, or section labels outside of what is requested.
- Start directly with the content. Write in continuous prose unless a table is requested.
- KK39 papers are clean and institutional — not dry, but precise and always evidence-driven."""


# ── Score Context Builder ──────────────────────────────────────────────────
# Call this function to build score_context, then pass it into each section prompt.

def build_score_context(meta_data: dict, scores_data: dict) -> str:
    return f"""INVESTMENT DETAILS:
- Fund: {meta_data['fundName']}
- Proposed allocation: {meta_data['allocation']} ({meta_data['currency']})
- Written by: {meta_data['writtenBy']}
- Endorsed by: {meta_data['endorsedBy']}
- Date: {meta_data['submissionDate']}
{f"- Additional context: {meta_data['additionalContext']}" if meta_data.get('additionalContext') else ''}

KK39 SCORES (use these exact scores in all scoring tables and commentary):
P1A Sector Trajectory:         {scores_data['p1a']}/5.0
P1B Sector Resilience:         {scores_data['p1b']}/5.0
P2A Management Team:           {scores_data['p2a']}/5.0
P2B Fund Size Track Record:    {scores_data['p2b']}/5.0
P2C Investment Track Record:   {scores_data['p2c']}/5.0
P2D Operational Value-Add:     {scores_data['p2d']}/5.0
P3A Fund Strategy:             {scores_data['p3a']}/5.0
P3B Fundraising & LP Quality:  {scores_data['p3b']}/5.0
P3C IC Process & Structure:    {scores_data['p3c']}/5.0
P3D Deal Sourcing:             {scores_data['p3d']}/5.0
P4A Fund Terms:                {scores_data['p4a']}/5.0
P4B LP Protections:            {scores_data['p4b']}/5.0"""


# ── Scoring Opinions Prompt ────────────────────────────────────────────────
# Replaces the old 4-sentence scoring_opinions_prompt.
# Pass score_context into this before calling Claude.

def build_scoring_opinions_prompt(score_context: str) -> str:
    return f"""{score_context}

Using the fund documents and the scores above, write a 2-sentence analytical rationale \
for each of the 12 scoring criteria. Each rationale must:
- Justify the score with specific evidence from the documents (figures, names, structural features).
- Acknowledge the key weakness or risk relevant to that criterion, even for high scores.
- Be direct. Do not use promotional language.

Return ONLY valid JSON with exactly these 12 keys:
p1a, p1b, p2a, p2b, p2c, p2d, p3a, p3b, p3c, p3d, p4a, p4b

Each value is a string containing exactly 2 sentences. No markdown, no preamble, no trailing text.

Example format:
{{
  "p1a": "Sentence one justifying the score. Sentence two noting the key risk or caveat.",
  "p1b": "...",
  ...
}}"""


# ── Section Prompts ────────────────────────────────────────────────────────
# All section prompts now include a critical lens instruction and
# max_tokens is raised to 4000 for body sections (see call_claude calls below).

def build_section_prompts(meta_data: dict, score_context: str) -> dict:

    fund_name = meta_data['fundName']
    written_by = meta_data['writtenBy']
    endorsed_by = meta_data['endorsedBy']
    submission_date = meta_data['submissionDate']
    allocation = meta_data['allocation']

    CRITICAL_LENS = """
CRITICAL LENS: For every positive claim, verify it is supported by evidence in the documents \
rather than GP assertion alone. Surface structural concerns, missing governance terms, and \
LP-unfriendly features with equal prominence to strengths. If the documents do not provide \
sufficient evidence for a claim, say so explicitly."""

    return {

        # ── Executive Summary (kept short — EXCO-facing) ──────────────────

        "exec_summary_opportunity": f"""Write ONE tight paragraph of 4–5 sentences summarising \
the fund's core opportunity for EXCO — what it is, who runs it, what it targets, and why the \
timing is relevant. Be specific: include fund size, strategy type, geography, and current raise \
amount. Do not editorialize. State facts and let the reader draw conclusions.""",

        "exec_summary_management": f"""Write ONE tight paragraph of 3–4 sentences summarising \
the founding team for EXCO — names, titles, most relevant prior experience, and GP commitment \
percentage and dollar amount. Note any key person concentration risk in one sentence.""",

        "exec_summary_fund": f"""Write ONE tight paragraph of 3–4 sentences summarising the \
fund structure for EXCO — target size, management fee, carry, hurdle rate (or absence thereof), \
lock-up, and target returns. Flag any fee terms that deviate from market standard.""",

        "exec_summary_track_record": f"""Write ONE tight paragraph of 3–4 sentences summarising \
fund performance for EXCO — inception-to-date figures versus benchmarks, DPI vs MOIC split, \
and the most notable portfolio company outcomes. Be clear about what is realised versus paper \
markup. Note if the track record is early-stage or limited in duration.""",

        "exec_summary_value_prop": f"""Write a markdown table with 2 columns (Pillar | Summary) \
and 5–6 rows. Use these pillar names: Pedigree, Performance, Structure, Fees, Alpha, Access. \
Each summary should be 1–2 sentences — analytical, not promotional. Include one honest \
qualification per row where relevant.""",

        "exec_summary_dd": f"""Write ONE tight paragraph of 3–4 sentences summarising the DD \
process for EXCO — what was reviewed, how many meetings, how many reference calls, and the \
headline conclusion including any residual concerns.""",

        # ── Body Sections (max_tokens=4000) ───────────────────────────────

        "opportunity": f"""{score_context}
{CRITICAL_LENS}

Write Section 1 — The Opportunity for the {fund_name} IC paper.

Structure:
(a) Opening 2 paragraphs on why this fund presents a differentiated opportunity at this point \
in the market cycle. Ground every claim in evidence. Acknowledge crowding risk, timing risk, \
or structural concerns where they exist alongside the opportunity.
(b) **About {fund_name}** sub-section: AUM or fund size, structure, geographic mandate, \
investment strategy overview, and portfolio composition as of the most recent data.
(c) The current raise — amount, stated purpose of the capital, first close target, and \
any conditions on the closing timeline.

Write in flowing paragraphs. All figures must be sourced from the documents.
Target length: 550–650 words.""",

        "management": f"""{score_context}
{CRITICAL_LENS}

Write Section 2 — Management Team for the {fund_name} IC paper.

Structure:
- For each key person, use a **Name — Title** sub-heading followed by a paragraph covering: \
background, years of experience, specific prior firms and roles, and the most relevant \
achievements for this fund's thesis. Do not simply list credentials — assess their relevance.
- For Venture Partners or advisory roles, explicitly note their time allocation and the \
limits of their involvement where applicable.
- Include a summary table: | Name | Title | Prior Experience | Total Experience |
- Close with a paragraph on GP commitment — amount, percentage of fund, and what it signals \
about alignment. Note any caveats (e.g. calculated as % of lower bound vs upper bound).
- If key person concentration exists, state it directly and assess the mitigation, if any.

Target length: 550–650 words.""",

        "fund": f"""{score_context}
{CRITICAL_LENS}

Write Section 3 — The Fund for the {fund_name} IC paper.

Structure:
(a) Opening paragraph on the fund's raise history, current vehicle number, and the purpose \
of this raise round.
(b) **Fund Terms** table with all key terms: | Term | Detail | — cover target size, \
investment period, follow-on period, fund life and extensions, management fee (with exact \
structure and whether it steps down post-investment period), carried interest, hurdle rate \
(or absence thereof), GP commitment, first close target, administrator, CFO, legal counsel.
(c) **Investment Strategy & Themes** — 3 sub-themes using **Theme I:**, **Theme II:**, \
**Theme III:** headings. Each theme: 100–150 words of analytical depth assessing the thesis \
and its risks. Do not simply describe the theme — evaluate it.
(d) **Portfolio Construction** table: | Stage | Number | Check Size | Total Allocation | \
Target Ownership | — then a paragraph assessing whether the construction is internally \
consistent and whether the follow-on reserve is adequate.

Target length: 750–900 words.""",

        "track_record": f"""{score_context}
{CRITICAL_LENS}

Write Section 4 — Track Record for the {fund_name} IC paper.

Structure:
(a) **Founder Track Record** — the GP's pre-fund investing and operating history. \
Be specific: firm names, investment examples, dollar figures. Assess what this track record \
does and does not demonstrate about the current fund's strategy.
(b) **Fund Performance** table: | Fund | Vintage | DPI | MOIC | Benchmark DPI (Top Quartile) \
| Benchmark MOIC (Top Quartile) | — with a paragraph beneath assessing the quality of these \
returns. Distinguish realised (DPI) from unrealised (MOIC). Note if any fund is too early \
to draw conclusions.
(c) **Notable Portfolio Companies** table: | Company | Entry Stage | Recursive Value-Add \
| Outcome / Current Status | — then assess the breadth of exit paths and whether any single \
outcome is disproportionately driving reported performance.
(d) If any fund is early-stage or the track record has gaps, state this clearly. \
Do not project forward performance from limited data.

Target length: 550–650 words.""",

        "value_prop": f"""{score_context}
{CRITICAL_LENS}

Write Section 5 — Value Proposition for the {fund_name} IC paper.

Write 5–6 sub-sections, each with a **Bold Header** of 3–5 words followed by 3–4 sentences \
of analytical commentary. Suggested headers: Proven Pedigree, Track Record Quality, \
Fund Size Discipline, Fee Alignment, Sourcing Moat, Alpha Generation Thesis.

For each sub-section: lead with the strongest evidence for this pillar, then in the final \
sentence of each sub-section, note the key qualification, risk, or limitation that a \
sophisticated LP should weigh. Do not write unqualified promotional prose.

Target length: 550–650 words.""",

        "due_diligence": f"""{score_context}

Write Section 6 — Due Diligence for the {fund_name} IC paper.

Structure:
(a) Opening paragraph: overall DD scope, duration, what types of materials were reviewed, \
and the headline conclusion including any residual concerns that were not fully resolved.
(b) **Document Review** sub-section: a prose paragraph listing what was reviewed. \
Be specific — name the documents, audit firm, date of financials, etc.
(c) **Meetings with Fund Team** table: | Date | Attendees | Topics Covered | \
— each Topics Covered cell should name the specific subjects discussed, not generic summaries.
(d) **Reference Calls** table: | Party | Date | Key Themes | — each Key Themes cell \
should include 2–3 specific, attributed observations from that call. Include at least one \
critical or cautionary reference observation if one exists in the documents.

Target length: 500–600 words.""",

        "legal": f"""{score_context}

Write Section 7 — Legal for the {fund_name} IC paper.

Open with 1–2 sentences giving an overall characterisation of the legal terms — are they \
market standard, LP-friendly, GP-friendly, or mixed? Flag the single most important \
non-standard term in the opening.

Then produce a comprehensive terms table: | Term | Section Reference | Description |

Include all of the following rows (mark "Not disclosed" where absent from the documents — \
do not invent terms):
Effective Date, Fund Life, Investment Period, Follow-on Period, Management Fee \
(exact structure — note if no step-down), Performance Fee / Carry, Hurdle Rate, \
Lock-Up Period, Liquidity / Redemptions, Minimum Subscription, GP Commitment, \
Key Person Provisions, GP Removal Threshold, Co-Investment Rights, LPAC / Advisory Committee, \
Recycling Provisions, Distribution Waterfall, Governing Law, Fund Administrator, \
Fund CFO, Legal Counsel, Auditor.

Close with a paragraph identifying the most significant governance gaps — terms that are \
absent from the materials and that KK39 should negotiate in definitive documentation.

Target length: 450–550 words.""",

        "recommendation": f"""{score_context}

Write Section 8 — Final Recommendation for the {fund_name} IC paper.

State clearly in the first sentence whether KK39 recommends the investment of \
{allocation} into {fund_name}, and whether that recommendation is unconditional or \
subject to conditions.

Then write 3 paragraphs:
(1) The 3–4 principal reasons supporting the recommendation, each grounded in specific \
evidence from the documents. Do not introduce new claims here — synthesise what the \
paper has already established.
(2) The 2–3 most significant risks or conditions that KK39 will monitor post-commitment, \
or that must be resolved before wire transfer. Be direct about what could cause this \
investment to underperform.
(3) Proposed next steps — what actions are required before the commitment is finalised.

End with exactly this sentence structure:
"This paper was written by {written_by} and endorsed by {endorsed_by}. \
The paper was submitted via email to the Investment Committee on {submission_date}."

Target length: 280–320 words.""",

        # ── Legends Scoring Table ─────────────────────────────────────────
        # New section — was missing from the original section_prompts.
        # Generates the mid-paper summary scoring table matching KK39's house format.

        "legends_scoring": f"""{score_context}

Write the KK39 Legends Scoring section for the {fund_name} IC paper.

First, output this scoring key as a small table:
| Score | Meaning |
| 1 | Flagged issues with major concerns |
| 2 | Neutral evaluation with minor concerns |
| 3 | Positive evaluation with aspects to be considered |
| 4 | Positive evaluation with no or negligible concerns |

Then output the main scoring table with columns: | Section | KK39's Opinion | Score |

Include exactly these rows:
- The Opportunity
- Management Team
- The Fund
- Track Record
- Value Proposition
- Due Diligence
- Legal

For each row:
- KK39's Opinion: 2–3 sentences. Lead with the strongest supporting evidence for the score, \
then in the final sentence note the key risk or caveat that prevents a higher score. \
Be specific — reference actual figures, names, or structural features from the documents.
- Score: derive from the relevant pillar averages using the scores provided above. \
Round to 2 decimal places. Use this mapping: P1 avg → Opportunity; P2 avg → Management Team; \
P3 avg → The Fund; P4 avg → Legal. For Track Record use P2C. \
For Value Proposition use the overall weighted average. For Due Diligence use P3C.

End with one line:
**Final Weighted Score: [X.XX] — [Verdict]**
*(Formula: [(P1 × 1) + (P2 × 2) + (P3 × 2) + (P4 × 1)] / 6)*

Verdicts: 1.0–2.0 Pass | 2.1–3.0 Needs Work | 3.1–4.0 Conditional | 4.1–5.0 Recommend

Target length: the table rows should be substantive — do not truncate the opinion column.""",

    }
