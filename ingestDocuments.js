import { QdrantService } from './services/qdrantService.js';
import { Logger } from './logger.js';

const logger = new Logger();

async function ingestDocuments() {
    const directoryPath = 'kb';

    try {
        const qdrantService = new QdrantService();
        const result = await qdrantService.upsertFromDirectory(directoryPath, true);

        console.log(`Successfully ingested ${result.count} documents into Qdrant.`);
        logger.info(`Ingested ${result.count} documents`, { directoryPath });
    } catch (error) {
        console.error('Error ingesting documents:', error);
        logger.error('Document ingestion failed', { error: error.message });
    }
}

ingestDocuments();

