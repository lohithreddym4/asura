import { formatRetrievedContext, retrieveDocuments } from "../memory/rag.js";

export function buildContext(userInput, memory) {
  const retrieved = retrieveDocuments(userInput, memory.allDocuments());

  return {
    retrieved,
    ragContext: formatRetrievedContext(retrieved)
  };
}
