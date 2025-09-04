import dotenv from 'dotenv';
dotenv.config();
import { QdrantClient } from "@qdrant/js-client-rest";
import { Logger } from "../logger.js";
import { GoogleGenAI } from "@google/genai";
import fs from 'fs/promises';
import path from 'path';

import { marked } from 'marked';
import pdfParse from 'pdf-parse';
import { JSDOM } from 'jsdom';
import { randomUUID } from 'crypto';

// Initialize logger
const logger = new Logger();

// Check for required environment variables
if (!process.env.QDRANT_API_KEY || !process.env.QDRANT_URL) {
    logger.error('Missing required environment variables: QDRANT_API_KEY or QDRANT_URL');
    throw new Error('QDRANT_API_KEY or QDRANT_URL is not set in the environment');
}

if (!process.env.GEMINI_API_KEY) {
    logger.error('Missing required environment variable: GEMINI_API_KEY');
    throw new Error('GEMINI_API_KEY is not set in the environment');
}

class QdrantService {
    constructor(db_dict = {}) {
        // Validate db_dict
        if (typeof db_dict !== 'object' || db_dict === null) {
            logger.error('db_dict must be an object');
            throw new Error('db_dict must be an object');
        }

        // Initialize class properties
        this.db_dict = db_dict;
        this.collections_name = db_dict.collections_name || 'icslearningtechv2';
        this.qdrant_url = db_dict.qdrant_url || process.env.QDRANT_URL;
        this.qdrant_api_key = db_dict.qdrant_api_key || process.env.QDRANT_API_KEY;

        // Initialize Qdrant client
        this.client = new QdrantClient({
            url: this.qdrant_url,
            apiKey: this.qdrant_api_key
        });

        this.gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    async generateEmbeddings(input) {
        try {
            const texts = Array.isArray(input) ? input : [input];
            const result = await this.gemini.models.embedContent({
                model: 'gemini-embedding-001', // Updated to newer model
                contents: texts.map(text => ({ parts: [{ text }] })),
                taskType: 'RETRIEVAL_DOCUMENT', // Better for document storage
            });
            
            return Array.isArray(input) ? result.embeddings.map(e => e.values) : result.embeddings[0].values;
        } catch (error) {
            logger.error('Failed to generate embeddings', { error: error.message });
            throw error;
        }
    }

    async initializeCollection() {
        try {
            await this.client.getCollection(this.collections_name);
            logger.info(`Collection ${this.collections_name} already exists`);
        } catch (error) {
            if (error.status === 404) {
                await this.client.createCollection(this.collections_name, {
                    vectors: { size: 3072, distance: 'Cosine' }
                });
                logger.info(`Created collection: ${this.collections_name}`);
            } else {
                throw error;
            }
        }
    }

    // Text chunking utility for large documents
    chunkText(text, maxChunkSize = 1000, overlap = 100) {
        const chunks = [];
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        
        let currentChunk = '';
        let currentLength = 0;
        
        for (const sentence of sentences) {
            const sentenceLength = sentence.trim().length;
            
            if (currentLength + sentenceLength > maxChunkSize && currentChunk) {
                chunks.push(currentChunk.trim());
                
                // Start new chunk with overlap
                const words = currentChunk.split(' ');
                const overlapWords = words.slice(-Math.floor(overlap / 10));
                currentChunk = overlapWords.join(' ') + ' ' + sentence.trim();
                currentLength = currentChunk.length;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence.trim();
                currentLength = currentChunk.length;
            }
        }
        
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks.length > 0 ? chunks : [text];
    }

    // File processing methods
    async processMarkdownFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const html = marked(content);
            const dom = new JSDOM(html);
            const text = dom.window.document.body.textContent || '';
            return this.chunkText(text);
        } catch (error) {
            logger.error(`Failed to process markdown file: ${filePath}`, { error: error.message });
            return [];
        }
    }

    async processPdfFile(filePath) {
        try {
            const buffer = await fs.readFile(filePath);
            const data = await pdfParse(buffer);
            return this.chunkText(data.text);
        } catch (error) {
            logger.error(`Failed to process PDF file: ${filePath}`, { error: error.message });
            return [];
        }
    }

    async processHtmlFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const dom = new JSDOM(content);
            const text = dom.window.document.body.textContent || '';
            return this.chunkText(text);
        } catch (error) {
            logger.error(`Failed to process HTML file: ${filePath}`, { error: error.message });
            return [];
        }
    }

    async processTextFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return this.chunkText(content);
        } catch (error) {
            logger.error(`Failed to process text file: ${filePath}`, { error: error.message });
            return [];
        }
    }

    async processFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const fileName = path.basename(filePath);
        
        logger.info(`Processing file: ${fileName}`);
        
        let chunks = [];
        switch (ext) {
            case '.md':
            case '.markdown':
                chunks = await this.processMarkdownFile(filePath);
                break;
            case '.pdf':
                chunks = await this.processPdfFile(filePath);
                break;
            case '.html':
            case '.htm':
                chunks = await this.processHtmlFile(filePath);
                break;
            case '.txt':
                chunks = await this.processTextFile(filePath);
                break;
            default:
                logger.warn(`Unsupported file type: ${ext} for file ${fileName}`);
                return [];
        }
        
        // Add metadata to chunks
        return chunks.map((chunk, index) => ({
            text: chunk,
            metadata: {
                fileName,
                filePath,
                chunkIndex: index,
                totalChunks: chunks.length,
                fileType: ext
            }
        }));
    }

    async processDirectory(directoryPath, recursive = true) {
        const supportedExtensions = ['.md', '.markdown', '.pdf', '.html', '.htm', '.txt'];
        const allDocuments = [];
        
        try {
            const items = await fs.readdir(directoryPath, { withFileTypes: true });
            
            for (const item of items) {
                const fullPath = path.join(directoryPath, item.name);
                
                if (item.isDirectory() && recursive) {
                    const subdirDocs = await this.processDirectory(fullPath, recursive);
                    allDocuments.push(...subdirDocs);
                } else if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase();
                    if (supportedExtensions.includes(ext)) {
                        const documents = await this.processFile(fullPath);
                        allDocuments.push(...documents);
                    }
                }
            }
            
            logger.info(`Processed ${allDocuments.length} document chunks from directory: ${directoryPath}`);
            return allDocuments;
        } catch (error) {
            logger.error(`Failed to process directory: ${directoryPath}`, { error: error.message });
            throw error;
        }
    }

    async upsertDocuments(documents) {
        try {
            if (!Array.isArray(documents) || documents.length === 0) {
                logger.error('documents must be a non-empty array');
                throw new Error('documents must be a non-empty array');
            }

            await this.initializeCollection();

            // Batch process for embeddings
            const batchSize = 10;
            const points = [];
            
            for (let i = 0; i < documents.length; i += batchSize) {
                const batch = documents.slice(i, i + batchSize);
                const texts = batch.map(doc => doc.text);
                const embeddings = await this.generateEmbeddings(texts);
                
                batch.forEach((doc, index) => {
                    points.push({
                        id: randomUUID(),
                        vector: embeddings[index],
                        payload: {
                            text: doc.text,
                            ...doc.metadata
                        }
                    });
                });
                
                // Small delay to avoid rate limiting
                if (i + batchSize < documents.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // Upsert points to Qdrant
            await this.client.upsert(this.collections_name, { points });
            logger.info(`Upserted ${points.length} document chunks to ${this.collections_name}`);

            return { status: 'success', count: points.length };
        } catch (error) {
            logger.error('Failed to upsert documents', { error: error.message });
            throw error;
        }
    }

    // Updated method for backward compatibility
    async upsertPoints(texts) {
        const documents = texts.map(text => ({
            text,
            metadata: { source: 'direct_input' }
        }));
        return this.upsertDocuments(documents);
    }

    // Directory upsert method
    async upsertFromDirectory(directoryPath, recursive = true) {
        try {
            const documents = await this.processDirectory(directoryPath, recursive);
            if (documents.length === 0) {
                logger.warn(`No supported files found in directory: ${directoryPath}`);
                return { status: 'success', count: 0 };
            }
            return await this.upsertDocuments(documents);
        } catch (error) {
            logger.error(`Failed to upsert from directory: ${directoryPath}`, { error: error.message });
            throw error;
        }
    }

    async searchSimilarTexts(query, k = 3, filter = null) {
        try {
            const queryEmbedding = await this.generateEmbeddings(query);
            const searchParams = {
                vector: queryEmbedding,
                limit: k,
                with_payload: true
            };
            
            if (filter) {
                searchParams.filter = filter;
            }
            
            const results = await this.client.search(this.collections_name, searchParams);
            
            return results.map(result => ({
                text: result.payload.text,
                score: result.score,
                metadata: {
                    fileName: result.payload.fileName,
                    fileType: result.payload.fileType,
                    chunkIndex: result.payload.chunkIndex
                }
            }));
        } catch (error) {
            logger.error('Failed to search similar texts', { error: error.message });
            throw error;
        }
    }

    // Get collection info
    async getCollectionInfo() {
        try {
            const info = await this.client.getCollection(this.collections_name);
            return info;
        } catch (error) {
            logger.error('Failed to get collection info', { error: error.message });
            throw error;
        }
    }

    // Delete collection
    async deleteCollection() {
        try {
            await this.client.deleteCollection(this.collections_name);
            logger.info(`Deleted collection: ${this.collections_name}`);
        } catch (error) {
            logger.error('Failed to delete collection', { error: error.message });
            throw error;
        }
    }
}

export { QdrantService };