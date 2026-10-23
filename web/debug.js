"use strict";

const REFRESH_MS = 2000;

const el = (id) => document.getElementById(id);
const keyInput = el("key");
const statusEl = el("status");

let lastAction = null;
let timer = null;

function storedKey() {
	const fromUrl = new URLSearchParams(location.search).get("key");
	if (fromUrl) {
		localStorage.setItem("mcp-key", fromUrl);
		return fromUrl;
	}
	return localStorage.getItem("mcp-key") || "";
}

keyInput.value = storedKey();
keyInput.addEventListener("change", () => {
	localStorage.setItem("mcp-key", keyInput.value.trim());
	refresh();
});

function headers() {
	const key = keyInput.value.trim();
	const result = { "content-type": "application/json" };
	if (key) result["x-api-key"] = key;
	return result;
}

function setStatus(text, isError) {
	statusEl.textContent = text;
	statusEl.classList.toggle("err", Boolean(isError));
}

function fmt(value) {
	if (typeof value !== "number") return String(value);
	return Math.round(value).toLocaleString("ru-RU");
}

function fmtTime(sec) {
	const total = Math.max(0, Math.floor(sec));
	const min = Math.floor(total / 60);
	const rest = total % 60;
	return `${min} мин ${rest} с`;
}

function renderRows(tbody, rows) {
	tbody.replaceChildren();
	if (rows.length === 0) {
		const tr = document.createElement("tr");
		const td = document.createElement("td");
		td.colSpan = 6;
		td.className = "note";
		td.textContent = "пусто";
		tr.append(td);
		tbody.append(tr);
		return;
	}
	for (const row of rows) {
		const tr = document.createElement("tr");
		for (const cell of row) {
			const td = document.createElement("td");
			if (cell.num) td.className = "num";
			if (cell.node) td.append(cell.node);
			else td.textContent = cell.text;
			tr.append(td);
		}
		tbody.append(tr);
	}
}

function renderDefinitions(dl, pairs) {
	dl.replaceChildren();
	for (const [label, value] of pairs) {
		const dt = document.createElement("dt");
		dt.textContent = label;
		const dd = document.createElement("dd");
		dd.textContent = value;
		dl.append(dt, dd);
	}
}

function effectText(effect) {
	if (!effect) return "";
	if (effect.kind === "productionMultiplier") {
		return `производство ${effect.skill ?? "все"} +${effect.valuePerLevel}/ур`;
	}
	if (effect.kind === "passiveIncome") {
		return `пассивный доход +${effect.valuePerLevel}/ур`;
	}
	if (effect.kind === "xpMultiplier") {
		return `XP ${effect.skill ?? "все"} +${effect.valuePerLevel}/ур`;
	}
	return `открывает ${effect.feature}`;
}

function button(label, onClick, disabled) {
	const node = document.createElement("button");
	node.type = "button";
	node.textContent = label;
	node.disabled = Boolean(disabled);
	node.addEventListener("click", onClick);
	return node;
}

function render(data) {
	el("player").textContent = `${data.player.label} (${data.player.id})`;
	el("dev-badge").hidden = !data.dev;
	el("ro-badge").hidden = data.canPlay !== false;
	const authOff = data.auth === "off";
	el("auth-badge").hidden = !authOff;
	keyInput.hidden = authOff;

	renderDefinitions(el("wallet"), [
		["Золото", fmt(data.wallet.gold)],
		["Кредиты", fmt(data.wallet.credits)],
		["Депозит", fmt(data.bank.deposits)],
		["Кредит", fmt(data.bank.credit)],
		["HP", `${fmt(data.health.hp)} / ${fmt(data.health.maxHp)}`],
		[
			"Престиж",
			`очки ${fmt(data.prestige.points)} · слои ${data.prestige.layers}`,
		],
	]);

	const travel = data.travel || {};
	const nowMs = data.now || Date.now();
	const travelUntil = travel.travelUntil;
	const isTraveling = Boolean(travelUntil && travelUntil > nowMs);

	const travelPairs = [["Регион", travel.activeZone ?? "не выбран"]];
	if (isTraveling) {
		const leftSec = Math.max(0, Math.ceil((travelUntil - nowMs) / 1000));
		travelPairs.push(["В пути до", fmtTime(leftSec)]);
		travelPairs.push(["Статус", "в пути"]);
	} else {
		travelPairs.push(["Путешествие", "доступно"]);
	}
	const features = travel.unlockedFeatures || [];
	if (features.length > 0) {
		travelPairs.push(["Разблокировано", features.join(", ")]);
	}
	renderDefinitions(el("travel"), travelPairs);

	const zoneButtons = el("zone-buttons");
	zoneButtons.replaceChildren();
	for (const zone of data.zones || []) {
		const isCurrent = zone.id === travel.activeZone;
		const btn = button(
			isCurrent ? `✓ ${zone.name}` : `→ ${zone.name}`,
			() => void act({ command: "switch", zoneId: zone.id }),
			data.canPlay === false || isCurrent || isTraveling,
		);
		zoneButtons.append(btn);
	}

	const action = data.activeAction;
	if (action) {
		lastAction = action;
		const left = action.endsAt - data.now;
		const total = Math.max(1, action.endsAt - action.startedAt);
		const done = Math.min(100, Math.max(0, (100 * (total - left)) / total));
		el("action-bar").style.width = `${done}%`;
		renderDefinitions(el("action"), [
			["Вид", action.kind],
			["Цель", action.targetId],
			["Осталось", fmtTime(left)],
			["Прогресс", `${done.toFixed(0)}%`],
		]);
	} else {
		el("action-bar").style.width = "0%";
		renderDefinitions(el("action"), [["Состояние", "нет активного действия"]]);
	}

	renderRows(
		el("skills"),
		data.skills.map((skill) => [
			{ text: skill.name },
			{ text: fmt(skill.level), num: true },
			{ text: fmt(skill.xp), num: true },
			{ text: fmt(skill.xpToNext), num: true },
		]),
	);

	renderRows(
		el("inventory"),
		data.inventory.map((item) => [
			{ text: item.name },
			{ text: fmt(item.qty), num: true },
		]),
	);

	renderRows(
		el("upgrades"),
		data.upgrades.map((upgrade) => [
			{ text: upgrade.name },
			{ text: `${upgrade.level} / ${upgrade.maxLevel}`, num: true },
			{
				text: upgrade.nextCost === null ? "макс" : fmt(upgrade.nextCost),
				num: true,
			},
			{ text: effectText(upgrade.effect) },
			{
				node: button(
					"Купить",
					() => act({ command: "buy_upgrade", upgradeId: upgrade.id }),
					data.canPlay === false ||
						upgrade.nextCost === null ||
						upgrade.nextCost > data.wallet.gold,
				),
			},
		]),
	);

	renderRows(
		el("market"),
		data.market.prices.map((price) => [
			{ text: price.name },
			{ text: fmt(price.sell), num: true },
			{ text: fmt(price.buy), num: true },
		]),
	);

	renderRows(
		el("quests"),
		data.quests.map((quest) => [
			{ text: quest.name },
			{ text: quest.status },
			{ text: `${quest.completedSteps} / ${quest.totalSteps}`, num: true },
			{
				node: button(
					"Забрать",
					() => act({ command: "claim_quest", questId: quest.id }),
					data.canPlay === false || quest.status !== "completed",
				),
			},
		]),
	);

	const feed = el("feed");
	feed.replaceChildren();
	if (data.events.length === 0) {
		const line = document.createElement("div");
		line.className = "note";
		line.textContent = "событий нет";
		feed.append(line);
	}
	for (const event of data.events) {
		const line = document.createElement("div");
		const when = new Date(event.ts * 1000).toLocaleTimeString("ru-RU");
		line.textContent = `${when} ${event.type} ${JSON.stringify(event.payload)}`;
		feed.append(line);
	}

	el("pause").disabled = data.canPlay === false || !action;
	el("resume").disabled = data.canPlay === false || !lastAction;
	el("advance").disabled = data.canPlay === false;
}

async function refresh() {
	try {
		const response = await fetch("/api/state", {
			headers: headers(),
			cache: "no-store",
		});
		const data = await response.json();
		if (!response.ok) {
			setStatus(data.error || `ошибка ${response.status}`, true);
			return;
		}
		render(data);
		setStatus(`обновлено ${new Date().toLocaleTimeString("ru-RU")}`, false);
	} catch (error) {
		setStatus(`сеть недоступна: ${error.message}`, true);
	}
}

async function act(payload) {
	try {
		const response = await fetch("/api/action", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify(payload),
		});
		const data = await response.json();
		if (!response.ok) {
			setStatus(data.error || `ошибка ${response.status}`, true);
			return;
		}
		setStatus("команда выполнена", false);
		await refresh();
	} catch (error) {
		setStatus(`сеть недоступна: ${error.message}`, true);
	}
}

el("reload").addEventListener("click", () => {
	void refresh();
});

el("pause").addEventListener("click", () => {
	void act({ command: "cancel" });
});

el("resume").addEventListener("click", () => {
	if (!lastAction) return;
	void act({
		command: "start",
		kind: lastAction.kind,
		skill: lastAction.skill,
		targetId: lastAction.targetId,
	});
});

el("advance").addEventListener("click", () => {
	const seconds = Number(el("seconds").value);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		setStatus("укажите число секунд больше нуля", true);
		return;
	}
	void act({ command: "advance", seconds: Math.floor(seconds) });
});

void refresh();
timer = setInterval(() => {
	if (document.hidden) return;
	void refresh();
}, REFRESH_MS);

window.addEventListener("beforeunload", () => {
	if (timer) clearInterval(timer);
});
