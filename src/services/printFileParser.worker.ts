import { parsePrintFile } from './printFileParser.ts';

self.onmessage = (event: MessageEvent<{ fileName: string; buffer: ArrayBuffer }>) => {
  self.postMessage(parsePrintFile(event.data.fileName, new Uint8Array(event.data.buffer)));
};
