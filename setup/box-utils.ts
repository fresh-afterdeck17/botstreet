import { Box } from "@upstash/box";

type BoxLookupOptions = {
  apiKey?: string;
  baseUrl?: string;
  gitToken?: string;
  timeout?: number;
  debug?: boolean;
};

export async function getBoxByName(name: string, options?: BoxLookupOptions): Promise<Box> {
  const boxes = await Box.list(options);
  const match = boxes.find((box: any) => box.name === name);

  if (!match) {
    throw new Error(`Box not found by name: ${name}`);
  }

  return await Box.get(match.id, options);
}

export function isBoxNotFoundError(error: unknown, name?: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (name) {
    return error.message === `Box not found by name: ${name}`;
  }

  return error.message.startsWith("Box not found by name: ");
}
