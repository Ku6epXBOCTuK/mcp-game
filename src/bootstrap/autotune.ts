import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FileContentRepository } from "../infrastructure/content/loader.ts";
import { autotune } from "../infrastructure/sim/autotune.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const contentDir = process.argv[2]
	? resolve(process.argv[2])
	: config.contentDir;
const hours = Number(process.argv[3] ?? 24);

const repo = new FileContentRepository(contentDir);
const loaded = await repo.load();
if (loaded.isErr()) {
	console.error(loaded.error);
	process.exit(1);
}

const result = autotune({
	content: loaded.value,
	durationSec: hours * 3600,
	seed: 7,
});

const target = resolve(contentDir, "balance.json");
writeFileSync(target, `${JSON.stringify(result.balance, null, 2)}\n`, "utf8");

console.log(`balance.json обновлён: ${target}`);
console.log(`прогонов: ${result.trials}, score: ${result.score}`);
for (const change of result.changes) console.log(`  ${change}`);
console.log(
	`критерии: payback ${result.metrics.medianPaybackSec ?? "-"} с, престиж ${result.metrics.timeToPrestigeSec ?? "-"} с, idle ${result.metrics.idleRatio}, пройдено ${result.metrics.criteria.passed}`,
);
