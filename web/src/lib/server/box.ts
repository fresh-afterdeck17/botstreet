import { Box } from '@upstash/box';
import { env } from '$env/dynamic/private';

export async function getBoxByName(name: string): Promise<Box> {
	const boxes = await Box.list({ apiKey: env.UPSTASH_BOX_API_KEY });
	const match = boxes.find((box: any) => box.name === name);

	if (!match) {
		throw new Error(`Box not found by name: ${name}`);
	}

	const box = await Box.get(match.id, { apiKey: env.UPSTASH_BOX_API_KEY });

	// Workaround: wake idle boxes before file access (upstash/box#110)
	try {
		await box.exec.command('pwd');
	} catch {
		// ignore wake-up errors
	}

	return box;
}
