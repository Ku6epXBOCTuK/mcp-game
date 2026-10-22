import { FileContentRepository } from "../infrastructure/content/loader.ts";
import { simulate } from "../domain/game/simulator.ts";

const repo = new FileContentRepository(process.argv[3] ?? "content");
const loaded = await repo.load();
if (loaded.isErr()) {
	console.error(loaded.error);
	process.exit(1);
}
const hours = Number(process.argv[2] ?? 6);
const result = simulate({
	content: loaded.value,
	durationSec: hours * 3600,
	seed: 7,
});
console.log(JSON.stringify(result.metrics, null, 2));
