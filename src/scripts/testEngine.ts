import { parseFlags } from "../engine/flagsParser.js";
import { calculateAetherValue } from "../engine/summonEngine.js";

function testEngine() {
  console.log("🧪 Testando Flags Parser e Fórmulas Matemáticas...");

  // 1. Teste de Flags
  const flags = parseFlags("ptwk=y! --Naruto $ Dragon Ball");
  console.log("Flags parseadas:", {
    gender: flags.gender,
    sortByAether: flags.sortByAether,
    soulmatesOnly: flags.soulmatesOnly,
    excluded: flags.excludedTerms,
    args: flags.arguments,
  });

  if (flags.gender !== "FEMALE" || !flags.sortByAether || !flags.soulmatesOnly) {
    throw new Error("Falha no teste do Flags Parser!");
  }

  // 2. Teste de Cálculo de Éter
  const standardVal = calculateAetherValue(100, "STANDARD", 0);
  const foilVal = calculateAetherValue(100, "FOIL", 0);
  const holoVal = calculateAetherValue(100, "HOLO", 0);
  const astralVal = calculateAetherValue(100, "ASTRAL", 0);
  const keysVal = calculateAetherValue(100, "STANDARD", 6); // 1.0 + 0.1(lvl2) + 0.1(lvl4) + 0.1(lvl5) = 1.3

  console.log("Valores de Éter calculados:", {
    standardVal,
    foilVal,
    holoVal,
    astralVal,
    keysVal,
  });

  if (standardVal !== 100 || foilVal !== 125 || holoVal !== 175 || astralVal !== 400 || keysVal !== 130) {
    throw new Error("Falha no cálculo matemático de Éter!");
  }

  console.log("✅ Todos os testes de motor matemático e parser passaram com sucesso!");
}

testEngine();
