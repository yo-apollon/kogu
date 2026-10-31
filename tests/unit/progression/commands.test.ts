import { describe, expect, it } from "vitest";
import { commands, progressionComponentHandler } from "../../../src/modules/progression/commands.js";
import { PROGRESSION_NS } from "../../../src/modules/progression/index.js";

describe("progression module commands", () => {
	it("registers all 15 progression, tutorial, and minigame commands", () => {
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
			"blacktea",
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
		expect(byName.get("blacktea")?.aliases).toContain("bt");
	});

	it("exports the progression component handler under namespace 'pg'", () => {
		expect(PROGRESSION_NS).toBe("pg");
		expect(progressionComponentHandler.namespace).toBe("pg");
	});
});
