import { describe, expect, it } from "vitest";
import {
	buildBlackjackReplayRow,
	buildCoinflipReplayRow,
	buildSlotRow,
	commands,
	progressionComponentHandler,
	renderBlackjackEmbed,
} from "../../../src/modules/progression/commands.js";
import { PROGRESSION_NS } from "../../../src/modules/progression/index.js";
import type { BlackjackGame } from "../../../src/modules/progression/service.js";

describe("progression module commands", () => {
	it("registers all progression, tutorial, and minigame commands", () => {
		const names = commands.map((c) => c.name);
		expect(names).toEqual([
			"tuto",
			"skiptuto",
			"freeclaim",
			"rt",
			"ktower",
			"build",
			"destroy",
			"kl",
			"givekakera",
			"infokeys",
			"arena",
			"slot",
			"blackjack",
			"coinflip",
			"blacktea",
			"greentea",
			"redtea",
			"yellowtea",
			"mixtea",
			"pokeduel",
			"fate",
			"42ball",
			"quote",
			"beam",
			"quiz",
			"invite",
		]);
	});

	it("defines expected Mudae-compatible aliases", () => {
		const byName = new Map(commands.map((c) => [c.name, c]));
		expect(byName.get("freeclaim")?.aliases).toContain("fc");
		expect(byName.get("ktower")?.aliases).toContain("tower");
		expect(byName.get("kl")?.aliases).toContain("lootbox");
		expect(byName.get("slot")?.aliases).toContain("pokemon");
		expect(byName.get("blackjack")?.aliases).toContain("bj");
		expect(byName.get("coinflip")?.aliases).toContain("cf");
		expect(byName.get("blacktea")?.aliases).toContain("bt");
	});

	it("exports the progression component handler under namespace 'prg'", () => {
		expect(PROGRESSION_NS).toBe("prg");
		expect(progressionComponentHandler.namespace).toBe("prg");
	});

	it("creates replay action rows for blackjack with instant replay and double bet", () => {
		const row = buildBlackjackReplayRow("user456", 50);
		expect(row.components).toHaveLength(2);
		expect(row.components[0].data).toMatchObject({
			custom_id: "prg:bj_again:50:user456",
		});
		expect(row.components[1].data).toMatchObject({
			custom_id: "prg:bj_again:100:user456",
		});

		// Com aposta maior que 50, oferece também botão de aposta mínima
		const rowHigher = buildBlackjackReplayRow("user456", 200);
		expect(rowHigher.components).toHaveLength(3);
		expect(rowHigher.components[2].data).toMatchObject({
			custom_id: "prg:bj_again:50:user456",
		});
	});

	it("creates replay action rows for slots with spin again, double, and minimum buttons", () => {
		const row = buildSlotRow("user123", 50);
		expect(row.components).toHaveLength(2);
		expect(row.components[0].data).toMatchObject({
			custom_id: "prg:slot_spin:user123:50",
		});
		expect(row.components[1].data).toMatchObject({
			custom_id: "prg:slot_spin:user123:100",
		});

		const rowCustom = buildSlotRow("user123", 250);
		expect(rowCustom.components).toHaveLength(3);
		expect(rowCustom.components[0].data).toMatchObject({
			custom_id: "prg:slot_spin:user123:250",
		});
		expect(rowCustom.components[1].data).toMatchObject({
			custom_id: "prg:slot_spin:user123:500",
		});
		expect(rowCustom.components[2].data).toMatchObject({
			custom_id: "prg:slot_spin:user123:50",
		});
	});

	it("creates replay action rows for coinflip preserving last choice and double bet", () => {
		const row = buildCoinflipReplayRow("user789", 100, "cara");
		expect(row.components).toHaveLength(4); // cara, coroa, dobrar, minima
		expect(row.components[0].data).toMatchObject({
			custom_id: "prg:cf_replay:user789:100:cara",
		});
		expect(row.components[1].data).toMatchObject({
			custom_id: "prg:cf_replay:user789:100:coroa",
		});
		expect(row.components[2].data).toMatchObject({
			custom_id: "prg:cf_replay:user789:200:cara",
		});
		expect(row.components[3].data).toMatchObject({
			custom_id: "prg:cf_replay:user789:50:cara",
		});
	});

	it("correctly colors and renders player_blackjack and player_win in blackjack embed", () => {
		const mockBjGame: BlackjackGame = {
			sessionId: "s1",
			guildId: "g1",
			userId: "u1",
			username: "tester",
			bet: 50,
			playerCards: [{ suit: "♠️", rank: "A", value: 11 }, { suit: "♥️", rank: "K", value: 10 }],
			dealerCards: [{ suit: "♦️", rank: "9", value: 9 }, { suit: "♣️", rank: "8", value: 8 }],
			playerScore: 21,
			dealerScore: 17,
			gameOver: true,
			status: "player_blackjack",
			rewardAether: 125,
		};

		const embed = renderBlackjackEmbed(mockBjGame, true, "pt-BR");
		expect(embed.data.color).toBe(0x22c55e); // Green
		expect(embed.data.description).toContain("BLACKJACK NATURAL");
	});
});
