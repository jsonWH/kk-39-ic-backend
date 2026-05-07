#!/bin/bash
# Install Python dependencies
pip install -r requirements.txt

# Install Node.js if not present (Render has it, but just in case)
node --version || apt-get install -y nodejs npm

# Install docx npm package globally
npm install -g docx
