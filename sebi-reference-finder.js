#!/usr/bin/env node

/**
 * SEBI Compliance Reference Finder - Node.js Version
 * 
 * AI-powered tool for SEBI compliance teams to automatically extract and analyze 
 * regulatory references from PDF documents.
 * 
 * Usage: node sebi-reference-finder.js <pdf_file>
 */

import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Get current directory (ES module equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LOCAL_CIRCULARS_DIR = "circulars";

// Validate required environment variables
if (!GEMINI_API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY environment variable is not set');
    console.error('Please create a .env.local file with: GEMINI_API_KEY=your_api_key_here');
    process.exit(1);
}

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

class EnhancedAIReferenceFinder {
    constructor() {
        this.localCirculars = {};
    }

    async loadLocalCirculars() {
        console.log(chalk.blue(`📁 Loading local circular database from: ${LOCAL_CIRCULARS_DIR}`));
        
        const circularsPath = path.join(__dirname, LOCAL_CIRCULARS_DIR);
        
        if (!await fs.pathExists(circularsPath)) {
            console.log(chalk.red(`❌ Directory not found: ${LOCAL_CIRCULARS_DIR}`));
            return;
        }

        const files = await fs.readdir(circularsPath);
        const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));

        for (const pdfFile of pdfFiles) {
            try {
                const filePath = path.join(circularsPath, pdfFile);
                const metadata = await this.extractMetadata(filePath);
                
                if (metadata) {
                    this.localCirculars[pdfFile] = {
                        file_path: path.resolve(filePath),
                        filename: pdfFile,
                        ...metadata
                    };
                    console.log(chalk.green(`  ✅ ${pdfFile}`));
                }
            } catch (error) {
                console.log(chalk.yellow(`  ⚠️ ${pdfFile}: ${error.message}`));
            }
        }

        console.log(chalk.green(`✅ Database ready: ${Object.keys(this.localCirculars).length} circulars`));
    }

    async extractMetadata(pdfPath) {
        try {
            const pdfBuffer = await fs.readFile(pdfPath);
            const data = await pdfParse(pdfBuffer, { max: 2 }); // First 2 pages only
            
            const text = data.text;
            
            return {
                circular_number: this.extractCircularNumber(text),
                subject: this.extractSubject(text),
                date: this.extractDate(text),
                key_terms: this.extractKeyTerms(text)
            };
        } catch (error) {
            return null;
        }
    }

    extractCircularNumber(text) {
        const patterns = [
            /SEBI\/[A-Z0-9\/_-]+\/(?:CIR|P)\/[A-Z0-9\/_-]+\/\d{4}\/\d+/i,
            /Circular[:\s]+No\.?\s*([A-Z0-9\/._-]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[0].includes('/') ? match[0] : match[1];
            }
        }
        return null;
    }

    extractSubject(text) {
        const patterns = [
            /Subject:\s*(.+?)(?:\n|$)/i,
            /Re:\s*(.+?)(?:\n|$)/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const subject = match[1].trim().replace(/\s+/g, ' ');
                if (subject.length > 10) {
                    return subject;
                }
            }
        }
        return null;
    }

    extractDate(text) {
        const pattern = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i;
        const match = text.match(pattern);
        return match ? match[0] : null;
    }

    extractKeyTerms(text) {
        const terms = [
            'investment adviser', 'registrar', 'depository', 'mutual fund',
            'portfolio', 'compliance', 'audit', 'charter', 'framework',
            'guidelines', 'norms', 'requirements', 'risk management',
            'kyc', 'aml', 'disclosure', 'governance', 'intermediary'
        ];
        
        const foundTerms = [];
        const textLower = text.toLowerCase();
        
        for (const term of terms) {
            if (textLower.includes(term)) {
                foundTerms.push(term);
            }
        }
        
        return foundTerms;
    }

    async extractTextFromPdf(pdfPath) {
        console.log(chalk.blue(`📄 Extracting text from: ${path.basename(pdfPath)}`));
        
        try {
            const pdfBuffer = await fs.readFile(pdfPath);
            const data = await pdfParse(pdfBuffer);
            
            // Add page markers like Python version
            const pages = data.text.split('\f'); // Form feed character separates pages
            let fullText = "";
            
            for (let i = 0; i < pages.length; i++) {
                fullText += `\n--- PAGE ${i + 1} ---\n${pages[i]}\n`;
            }
            
            console.log(chalk.green(`✅ Extracted text from ${pages.length} pages`));
            return { fullText, pageCount: pages.length };
            
        } catch (error) {
            console.log(chalk.red(`❌ Error reading PDF: ${error.message}`));
            return { fullText: "", pageCount: 0 };
        }
    }

    createEnhancedPrompt(documentText) {
        // Create detailed target list
        const targets = [];
        for (const [filename, circular] of Object.entries(this.localCirculars)) {
            let entry = `📄 ${filename}:`;
            
            if (circular.circular_number) {
                entry += `\n   Number: ${circular.circular_number}`;
            }
            
            if (circular.subject) {
                entry += `\n   Subject: ${circular.subject}`;
            }
            
            if (circular.date) {
                entry += `\n   Date: ${circular.date}`;
            }
            
            if (circular.key_terms && circular.key_terms.length > 0) {
                entry += `\n   Key terms: ${circular.key_terms.slice(0, 5).join(', ')}`;
            }
            
            targets.push(entry);
        }

        return `
You are an expert SEBI compliance analyst. Your task is to find ALL references to other regulatory documents (circulars, regulations, laws, etc.) in the given document.

📄 DOCUMENT TO ANALYZE:
${documentText}

🎯 SPECIFIC LOCAL CIRCULARS TO WATCH FOR:
${targets.join('\n')}

📋 FIND ALL REFERENCES TO:
1. SEBI circulars (any circular number like SEBI/HO/MIRSD/CIR/2021/670)
2. SEBI regulations (like SEBI (Research Analysts) Regulations, 2014)
3. RBI circulars and guidelines
4. Companies Act provisions
5. Other regulatory documents
6. References to "previous circular", "earlier guidelines", etc.

🔍 FOR EACH REFERENCE FOUND:
- exact_text: The exact text as it appears in the document
- reference_type: "sebi_circular", "sebi_regulation", "rbi_circular", "companies_act", "other_law", or "other"
- circular_number: Extract any circular/regulation number if mentioned
- title: The title or subject of the referenced document
- page_number: Which page this reference appears on
- context: The surrounding sentence where this reference appears
- confidence: How confident you are this is a real reference (high/medium/low)
- reasoning: Why you identified this as a reference
- matched_target: If this matches one of the local circulars above, specify the filename. Otherwise, put "external_reference"

🚨 IMPORTANT:
- Find ALL regulatory references, not just ones in the local list
- If a reference matches a local circular, set matched_target to that filename
- If a reference is to an external document, set matched_target to "external_reference"
- Include both specific circular numbers AND general references like "earlier circular"

Return ONLY a valid JSON array. Find everything - compliance teams need complete regulatory mapping.

Example:
[
  {
    "exact_text": "SEBI/HO/MIRSD/CIR/2021/670 dated March 15, 2021",
    "reference_type": "sebi_circular",
    "circular_number": "SEBI/HO/MIRSD/CIR/2021/670",
    "title": "Investment Adviser Guidelines",
    "page_number": 3,
    "context": "As per SEBI/HO/MIRSD/CIR/2021/670 dated March 15, 2021, all advisers must comply with disclosure norms.",
    "confidence": "high",
    "reasoning": "Specific SEBI circular number with exact date reference",
    "matched_target": "external_reference"
  }
]
`;
    }

    async analyzeWithEnhancedAI(pdfPath) {
        const { fullText } = await this.extractTextFromPdf(pdfPath);
        
        if (!fullText) {
            return [];
        }

        const spinner = ora('🤖 Running enhanced AI analysis...').start();
        
        try {
            const prompt = this.createEnhancedPrompt(fullText);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let responseText = response.text().trim();
            
            // Clean response
            if (responseText.startsWith('```json')) {
                responseText = responseText.slice(7);
            }
            if (responseText.startsWith('```')) {
                responseText = responseText.slice(3);
            }
            if (responseText.endsWith('```')) {
                responseText = responseText.slice(0, -3);
            }
            responseText = responseText.trim();
            
            const references = JSON.parse(responseText);
            
            spinner.succeed(chalk.green(`✅ AI found ${references.length} potential references`));
            return references;
            
        } catch (error) {
            spinner.fail(chalk.red(`❌ AI analysis error: ${error.message}`));
            return [];
        }
    }

    enhanceReferencesWithAvailability(references, sourceFilename) {
        const enhancedReferences = [];
        
        for (const ref of references) {
            const enhancedRef = { ...ref };
            const matchedTarget = ref.matched_target || '';
            
            // Check if it's a self-reference
            const isSelfReference = matchedTarget in this.localCirculars && 
                                  this.localCirculars[matchedTarget].filename === sourceFilename;
            
            if (isSelfReference) {
                enhancedRef.availability_status = 'self_reference';
                enhancedRef.note = 'Document referencing itself - excluded';
                continue;
            }
            
            // Check if we have this file locally
            if (matchedTarget in this.localCirculars) {
                const localFile = this.localCirculars[matchedTarget];
                enhancedRef.availability_status = 'available_locally';
                enhancedRef.local_file = {
                    filename: localFile.filename,
                    file_path: localFile.file_path,
                    circular_number: localFile.circular_number,
                    subject: localFile.subject,
                    date: localFile.date
                };
            } else {
                enhancedRef.availability_status = 'external_reference';
                enhancedRef.note = 'Referenced document not in local collection';
            }
            
            enhancedReferences.push(enhancedRef);
        }
        
        const localCount = enhancedReferences.filter(r => r.availability_status === 'available_locally').length;
        const externalCount = enhancedReferences.filter(r => r.availability_status === 'external_reference').length;
        
        console.log(chalk.green(`✅ Processed ${enhancedReferences.length} references: ${localCount} local, ${externalCount} external`));
        return enhancedReferences;
    }

    formatResults(references, sourceFilename) {
        console.log('\n' + '='.repeat(80));
        console.log(chalk.bold.blue('🤖 AI-BASED REFERENCE ANALYSIS RESULTS'));
        console.log(chalk.blue(`📄 Source: ${sourceFilename}`));
        console.log(chalk.blue(`🕐 Analyzed: ${new Date().toLocaleString()}`));
        console.log(chalk.blue(`🎯 Total References Found: ${references.length}`));
        console.log('='.repeat(80));
        
        if (references.length === 0) {
            console.log(chalk.red('❌ No references found.'));
            console.log(chalk.yellow('💡 The AI searched thoroughly but found no regulatory references.'));
            return;
        }
        
        // Group references by availability
        const localRefs = references.filter(r => r.availability_status === 'available_locally');
        const externalRefs = references.filter(r => r.availability_status === 'external_reference');
        
        console.log(chalk.blue(`📊 SUMMARY: ${localRefs.length} Local | ${externalRefs.length} External`));
        
        // Show local references first
        if (localRefs.length > 0) {
            console.log(chalk.green(`\n🟢 LOCAL REFERENCES (${localRefs.length}) - Available in your collection:`));
            
            localRefs.forEach((ref, i) => {
                const localFile = ref.local_file || {};
                console.log(chalk.green(`\n${i + 1}. 🟢 LOCAL REFERENCE:`));
                console.log(`   🤖 AI Confidence: ${chalk.bold((ref.confidence || 'unknown').toUpperCase())}`);
                console.log(`   📄 Text: ${ref.exact_text || 'N/A'}`);
                console.log(`   📍 Page: ${ref.page_number || 'N/A'}`);
                console.log(`   🎯 Links to: ${localFile.filename || 'N/A'}`);
                console.log(`   📋 Subject: ${localFile.subject || 'N/A'}`);
                if (localFile.circular_number) {
                    console.log(`   🔢 Number: ${localFile.circular_number}`);
                }
                console.log(`   💭 AI Reasoning: ${ref.reasoning || 'N/A'}`);
                console.log(`   📝 Context: ${(ref.context || 'N/A').substring(0, 200)}...`);
                console.log(`   💾 File: ${localFile.file_path || 'N/A'}`);
            });
        }
        
        // Show external references
        if (externalRefs.length > 0) {
            console.log(chalk.red(`\n🔴 EXTERNAL REFERENCES (${externalRefs.length}) - Need to obtain:`));
            
            externalRefs.forEach((ref, i) => {
                const refType = (ref.reference_type || 'other').replace(/_/g, ' ');
                console.log(chalk.red(`\n${i + 1}. 🔴 EXTERNAL REFERENCE:`));
                console.log(`   🤖 AI Confidence: ${chalk.bold((ref.confidence || 'unknown').toUpperCase())}`);
                console.log(`   📄 Text: ${ref.exact_text || 'N/A'}`);
                console.log(`   📍 Page: ${ref.page_number || 'N/A'}`);
                console.log(`   📂 Type: ${refType.charAt(0).toUpperCase() + refType.slice(1)}`);
                console.log(`   🎯 Title: ${ref.title || 'N/A'}`);
                if (ref.circular_number) {
                    console.log(`   🔢 Number: ${ref.circular_number}`);
                }
                console.log(`   💭 AI Reasoning: ${ref.reasoning || 'N/A'}`);
                console.log(`   📝 Context: ${(ref.context || 'N/A').substring(0, 200)}...`);
                console.log(`   📍 Source Info: Check relevant regulatory website`);
            });
        }
        
        // Compliance summary
        console.log(chalk.blue('\n🏦 COMPLIANCE SUMMARY:'));
        console.log(`   ✅ Local documents ready for review: ${localRefs.length}`);
        console.log(`   📥 External documents needed: ${externalRefs.length}`);
        if (externalRefs.length > 0) {
            console.log('   💡 Recommendation: Obtain external references for complete compliance review');
        }
    }

    async saveResults(references, sourceFilename, sourcePath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, -5);
        const outputFilename = `compliance_references_${path.parse(sourceFilename).name}_${timestamp}.json`;
        
        // Separate references by availability
        const localRefs = references.filter(r => r.availability_status === 'available_locally');
        const externalRefs = references.filter(r => r.availability_status === 'external_reference');
        
        const outputData = {
            source_file: sourceFilename,
            source_file_full_path: path.resolve(sourcePath),
            analysis_date: new Date().toISOString(),
            analysis_method: 'Enhanced AI with comprehensive prompting for compliance',
            local_circulars_scanned: Object.keys(this.localCirculars).length,
            summary: {
                total_references: references.length,
                local_references: localRefs.length,
                external_references: externalRefs.length
            },
            compliance_note: 'Complete regulatory reference analysis. Local references are immediately available for review. External references should be obtained for full compliance assessment.',
            local_references: localRefs,
            external_references: externalRefs,
            all_references: references
        };
        
        await fs.writeJson(outputFilename, outputData, { spaces: 2 });
        console.log(chalk.green(`\n💾 Compliance analysis saved to: ${outputFilename}`));
        return outputFilename;
    }
}

async function main() {
    const program = new Command();
    
    program
        .name('sebi-reference-finder')
        .description('AI-powered SEBI compliance reference finder')
        .version('1.0.0')
        .argument('<pdf_file>', 'PDF file to analyze')
        .action(async (pdfFile) => {
            try {
                // Validate input
                if (!await fs.pathExists(pdfFile)) {
                    console.log(chalk.red(`❌ Error: File '${pdfFile}' not found`));
                    process.exit(1);
                }
                
                if (!pdfFile.toLowerCase().endsWith('.pdf')) {
                    console.log(chalk.red(`❌ Error: '${pdfFile}' is not a PDF file`));
                    process.exit(1);
                }
                
                console.log(chalk.bold.blue('🚀 SEBI Enhanced AI Reference Finder'));
                console.log('='.repeat(50));
                
                const finder = new EnhancedAIReferenceFinder();
                
                // Load local circular database
                await finder.loadLocalCirculars();
                
                if (Object.keys(finder.localCirculars).length === 0) {
                    console.log(chalk.red('❌ No local circulars found'));
                    process.exit(1);
                }
                
                // Run AI analysis
                const references = await finder.analyzeWithEnhancedAI(pdfFile);
                
                // Enhance with availability info
                const enhancedReferences = finder.enhanceReferencesWithAvailability(
                    references, path.basename(pdfFile)
                );
                
                // Display results
                finder.formatResults(enhancedReferences, path.basename(pdfFile));
                
                // Save results
                await finder.saveResults(enhancedReferences, path.basename(pdfFile), pdfFile);
                
                console.log(chalk.green('\n✅ Enhanced AI reference analysis completed!'));
                
            } catch (error) {
                console.log(chalk.red(`❌ Error: ${error.message}`));
                process.exit(1);
            }
        });
    
    program.parse();
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.log(chalk.red('❌ Unhandled Rejection at:', promise, 'reason:', reason));
    process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
} 