const ROUND_COUNT = 12;
const SPIN_DURATION = 650;
const FEEDBACK_DURATION = 450;
const WORLD_GEOJSON_URL = "./data/world.geojson";

const elements = {
  globe: document.getElementById("globe"),
  roundLabel: document.getElementById("roundLabel"),
  scoreLabel: document.getElementById("scoreLabel"),
  wrongLabel: document.getElementById("wrongLabel"),
  modeSelect: document.getElementById("modeSelect"),
  feedbackText: document.getElementById("feedbackText"),
  guessInput: document.getElementById("guessInput"),
  submitButton: document.getElementById("submitButton"),
  history: document.getElementById("guessHistory"),
  flagImage: document.getElementById("flagImage"),
  gameTypeSelect: document.getElementById("gameTypeSelect"),
  reviewModal: document.getElementById("reviewModal"),
  reviewScoreText: document.getElementById("reviewScoreText"),
  playAgainButton: document.getElementById("playAgainButton"),
  reviewButton: document.getElementById("reviewButton"),
  regionSelect: document.getElementById("regionSelect")
};

const width = 760;
const height = 760;
const projection = d3.geoOrthographic().precision(0.5).translate([width / 2, height / 2]);
const path = d3.geoPath(projection);
const graticule = d3.geoGraticule10();

let globeGroup;
let landLayer;
let targetLayer;
let sphereLayer;
let outlineLayer;
let countries = [];
let roundOrder = [];
let currentRoundIndex = 0;
let correctCount = 0;
let wrongCount = 0;
let streakCount = 0;
let currentTarget = null;
let resultByCountry = new Map();
let feedbackTimer = null;
let isAnimating = false;
let gameFinished = false;
let currentScale = 332;
let currentRotation = [10, -10, 0];
let isDragging = false;
let dragStart = null;
let dragStartRotation = null;
let gameType = "country";
let reviewMode = false;
let reviewSelectedCountry = null;
let guessesByCountry = new Map();
let COUNTRY_TO_REGIONS = new Map();

const aliasMap = new Map([
  ["united states of america", "USA"],
  ["united states", "USA"],
  ["usa", "USA"],
  ["us", "USA"],
  ["america", "USA"],
  ["united kingdom", "England"],
  ["uk", "England"],
  ["great britain", "England"],
  ["britain", "England"],
  ["russia", "russian federation"],
  ["ivory coast", "cote d ivoire"],
  ["cote divoire", "cote d ivoire"],
  ["cote d'ivoire", "cote d ivoire"],
  ["south korea", "korea republic of"],
  ["north korea", "korea democratic peoples republic of"],
  ["czech republic", "czech republic"],
  ["dr congo", "democratic republic of the congo"],
  ["democratic republic of congo", "democratic republic of the congo"],
  ["congo kinshasa", "democratic republic of the congo"],
  ["republic of congo", "republic of the congo"],
  ["congo brazzaville", "republic of the congo"],
  ["tanzania", "united republic of tanzania"],
  ["syria", "syrian arab republic"],
  ["vietnam", "viet nam"],
  ["laos", "lao peoples democratic republic"],
  ["moldova", "republic of moldova"],
  ["bolivia", "bolivia plurinational state of"],
  ["venezuela", "venezuela bolivarian republic of"],
  ["palestine", "palestine state of"],
  ["czechia", "czech republic"],
  ["eswatini", "swaziland"],
  ["bosnia", "bosnia and herzegovina"],
  ["turkiye", "turkey"],
  ["timor-leste", "east timor"]
]);

const capitalAliasMap = new Map([
  ["washington", "washington, d.c."],
  ["dc", "washington, d.c."],
  ["washington dc", "washington, d.c."],
  ["washington, dc", "washington, d.c."],
  ["ottawa", "ottawa-gatineau"],
  ["hanoi", "ha noi"]
]);

function countryKey(country) {
  return String(country.id ?? country.properties?.name ?? country.name);
}

function buildRoundOrder() {

    let filtered = countries;
    const region = elements.regionSelect.value;
    if (region !== "world") {
        const allowed = new Set(CUSTOM_REGIONS[region]);
        filtered = countries.filter(country =>
            allowed.has(country.id)
        );
    }
    const allCountries = d3.shuffle(filtered);
    return elements.modeSelect.value === "all"
        ? allCountries
        : allCountries.slice(
            0,
            Math.min(ROUND_COUNT, allCountries.length)
        );
}

function fitGlobe() {

  if (gameType === "flag") {
    return;
  }
  
  const frame = elements.globe.closest(".globe-frame");
  if (!frame) {
    return;
  }

  const bounds = frame.getBoundingClientRect();
  const size = Math.max(260, Math.min(bounds.width, bounds.height));
  currentScale = Math.max(200, size * 0.46);
  projection.scale(currentScale).translate([width / 2, height / 2]);
  drawGlobe();
}

init();

async function init() {
  buildScene();
  wireControls();

  try {
    const world = window.WORLD_GEOJSON || await d3.json(WORLD_GEOJSON_URL);
    const regionData = await d3.json("./data/country-regions.json");
    COUNTRY_TO_REGIONS = new Map();

    for (const country of regionData) {

        const regions = [];

        if (country.region)
            regions.push(normalizeName(country.region));

        if (country["sub-region"])
            regions.push(normalizeName(country["sub-region"]));

        if (country["intermediate-region"])
            regions.push(normalizeName(country["intermediate-region"]));

        COUNTRY_TO_REGIONS.set(
            country["alpha-3"],
            regions
        );
    }
    COUNTRY_TO_REGIONS.set("OSA", [
        "europe",
        "southern europe"
    ]);

    countries = world.features
      .map((feature) => ({
        ...feature,
        name:
          feature.properties?.name ||
          feature.properties?.NAME ||
          feature.properties?.admin ||
          feature.properties?.ADMIN ||
          feature.properties?.sovereignt ||
          feature.properties?.SOVEREIGNT ||
          `Country ${feature.id}`,
        normalizedName: normalizeName(
          feature.properties?.name ||
            feature.properties?.NAME ||
            feature.properties?.admin ||
            feature.properties?.ADMIN ||
            feature.properties?.sovereignt ||
            feature.properties?.SOVEREIGNT ||
            `Country ${feature.id}`,
        ),
      }))
      .filter((country) => country.name && country.name !== "Antarctica");

      checkMissingFlags();

    roundOrder = buildRoundOrder();
    updateHud();
    startRound();
  } catch (error) {
    console.error(error);
  }
}

function buildScene() {
  elements.globe.innerHTML = "";
  globeGroup = d3.select(elements.globe).append("g");

  globeGroup
    .append("defs")
    .append("radialGradient")
    .attr("id", "oceanGlow")
    .attr("cx", "48%")
    .attr("cy", "38%")
    .attr("r", "64%")
    .call((gradient) => {
      gradient.append("stop").attr("offset", "0%").attr("stop-color", "#6fd0ff").attr("stop-opacity", 0.44);
      gradient.append("stop").attr("offset", "42%").attr("stop-color", "#173e64").attr("stop-opacity", 0.8);
      gradient.append("stop").attr("offset", "100%").attr("stop-color", "#08131f").attr("stop-opacity", 1);
    });

  sphereLayer = globeGroup.append("path").attr("fill", "url(#oceanGlow)").attr("stroke", "rgba(255,255,255,0.18)").attr("stroke-width", 1.5);
  globeGroup
    .append("path")
    .datum(graticule)
    .attr("fill", "none")
    .attr("stroke", "rgba(173, 214, 255, 0.12)")
    .attr("stroke-width", 0.8);

  landLayer = globeGroup.append("g").attr("class", "land-layer");
  outlineLayer = globeGroup.append("path").attr("fill", "none").attr("stroke", "rgba(255,255,255,0.35)").attr("stroke-width", 1.2);

  setupGlobeInteractions();
  fitGlobe();
  projection.rotate(currentRotation);
  drawGlobe();
}

function wireControls() {
  elements.submitButton.addEventListener("click", handleSubmit);
  elements.modeSelect.addEventListener("change", restartGame);
  elements.regionSelect.addEventListener("change", restartGame);
  elements.guessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleSubmit();
    }
  });
  elements.gameTypeSelect.addEventListener("change", () => {
    gameType = elements.gameTypeSelect.value;

    
    restartGame();
  });
  elements.playAgainButton.addEventListener("click", () => {
    elements.reviewModal.classList.add("hidden");
    reviewMode = false;
    restartGame();
  });

  elements.reviewButton.addEventListener("click", () => {
    elements.reviewModal.classList.add("hidden");
    enterReviewMode();
  });
}

function showFlag(country) {

  const code = FLAG_CODES[country.normalizedName];

  if (!code) {
    console.warn("Missing flag:", country.name);
    return;
  }

  elements.flagImage.src =
    `https://flagcdn.com/w320/${code}.png`;
}

function showCapital(country) {

  const capital = CAPITALS[country.normalizedName];

  if (!capital) {
    console.warn("Missing capital:", country.name);
    return;
  }

  // Hide the flag
  elements.flagImage.hidden = true;

  // Show the SVG
  elements.globe.style.display = "block";

  // Clear everything currently inside the SVG
  elements.globe.innerHTML = "";

  const svg = d3.select(elements.globe);

  // Country name
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 48)
    .attr("text-anchor", "middle")
    .attr("fill", "white")
    .attr("font-size", 28)
    .attr("font-weight", 700)
    .text(country.name);

  const projection = d3.geoMercator()
    .fitSize([520, 520], country);

  const path = d3.geoPath(projection);

  // Center the outline
  const g = svg.append("g")
    .attr("transform", "translate(120,110)");

  g.append("path")
    .datum(country)
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "white")
    .attr("stroke-width", 2);

  const p = projection([
    capital.lon,
    capital.lat
  ]);

  if (p) {

    g.append("text")
      .attr("x", p[0])
      .attr("y", p[1] + 8)
      .attr("text-anchor", "middle")
      .attr("fill", "#ffd700")
      .attr("font-size", 32)
      .text("★");

  }

}

function setupGlobeInteractions() {
  d3.select(elements.globe)
    .on("wheel", (event) => {
      event.preventDefault();
      const nextScale = Math.max(200, Math.min(720, currentScale * (event.deltaY > 0 ? 0.92 : 1.08)));
      currentScale = nextScale;
      projection.scale(currentScale);
      drawGlobe();
    })
    .on("pointerdown", (event) => {
      isDragging = true;
      dragStart = [event.clientX, event.clientY];
      dragStartRotation = projection.rotate();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    })
    .on("click", (event) => {
      if (!reviewMode) {
        return;
      }

      const [x, y] = d3.pointer(event, elements.globe);

      const coordinates = projection.invert([x, y]);

      if (!coordinates) {
        return;
      }

      const clickedCountry = countries.find(country =>
        d3.geoContains(country, coordinates)
      );

      if (clickedCountry) {
        showReviewCountry(clickedCountry);
      }
    })
    .on("pointermove", (event) => {
      if (!isDragging || !dragStart || !dragStartRotation) {
        return;
      }

      const dx = event.clientX - dragStart[0];
      const dy = event.clientY - dragStart[1];
      const nextRotation = [
        dragStartRotation[0] + dx * 0.25,
        Math.max(-90, Math.min(90, dragStartRotation[1] - dy * 0.22)),
        0,
      ];

      currentRotation = nextRotation;
      projection.rotate(currentRotation);
      drawGlobe();
    })
    .on("pointerup pointercancel pointerleave", (event) => {
      isDragging = false;
      dragStart = null;
      dragStartRotation = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    });
}

function restartGame() {
  window.clearTimeout(feedbackTimer);
  currentRoundIndex = 0;
  correctCount = 0;
  wrongCount = 0;
  streakCount = 0;
  currentTarget = null;
  resultByCountry = new Map();
  guessesByCountry = new Map();
  gameFinished = false;
  isAnimating = false;
  elements.guessInput.disabled = false;
  elements.submitButton.disabled = false;
  elements.guessInput.value = "";
  elements.history.innerHTML = "";
  roundOrder = buildRoundOrder();
  updateHud();
  elements.feedbackText.textContent = "‎ ";
  elements.feedbackText.className = "feedback";
  if (gameType === "flag") {
    elements.globe.style.display = "none";
    elements.flagImage.hidden = false;
  } else {
    elements.globe.style.display = "block";
    elements.flagImage.hidden = true;
  }
  startRound();
}

function startRound() {
  window.clearTimeout(feedbackTimer);

  if (currentRoundIndex >= roundOrder.length) {
    finishGame();
    return;
  }

  currentTarget = roundOrder[currentRoundIndex];

  fitGlobe();
  updateHud();

  elements.feedbackText.textContent = "‎ ";
  elements.feedbackText.className = "feedback";

  elements.guessInput.value = "";
  elements.guessInput.focus();

  isAnimating = true;

  if (gameType === "country") {

    elements.globe.style.display = "block";
    elements.flagImage.hidden = true;

    buildScene();

    spinToCountry(currentTarget, () => {
      isAnimating = false;
      drawGlobe();
    });

  }

  else if (gameType === "flag") {

    elements.globe.style.display = "none";
    elements.flagImage.hidden = false;

    showFlag(currentTarget);

    isAnimating = false;

  }

  else if (gameType === "capital") {

    showCapital(currentTarget);

    isAnimating = false;

  }

}
function enterReviewMode() {

  reviewMode = true;
  gameFinished = true;

  elements.guessInput.disabled = true;
  elements.submitButton.disabled = true;

  // Always review on the globe
  elements.globe.style.display = "block";
  elements.flagImage.hidden = true;

  // If we were in Capitals mode, the SVG currently contains an
  // outline + star instead of the globe, so rebuild the globe.
  buildScene();

  currentTarget = null;

  projection.rotate(currentRotation);

  drawGlobe();

  setupReviewInteraction();

  elements.history.innerHTML = `
    <h3>Review</h3>
    <p>Click a country to inspect your answer.</p>
  `;
}

function showReviewCountry(country) {

  const key = countryKey(country);
  const result = resultByCountry.get(key);

  if (!result) {
    return;
  }

  let iconHTML;
  let answerText;

  if (gameType === "flag") {

    const code = FLAG_CODES[country.normalizedName];

    iconHTML = `
      <img class="history-flag review-flag"
      src="https://flagcdn.com/w320/${code}.png">
    `;

    answerText = country.name;

  } else {

    const projection = d3.geoMercator()
      .fitSize([140,140], country);

    const reviewPath = d3.geoPath(projection);

    let star = "";

    if (gameType === "capital") {

      const capital = CAPITALS[country.normalizedName];

      answerText = capital ? capital.name : "Unknown";

      if (capital) {

        const p = projection([capital.lon, capital.lat]);

        if (p) {

          star = `
            <text
              x="${p[0]}"
              y="${p[1] + 5}"
              text-anchor="middle"
              font-size="16"
              fill="#ffd700">
              ★
            </text>
          `;

        }

      }

    } else {

      answerText = country.name;

    }

    iconHTML = `
      <svg
        width="140"
        height="140"
        viewBox="0 0 140 140">

        <path
          d="${reviewPath(country)}"
          fill="none"
          stroke="white"
          stroke-width="2"/>

        ${star}

      </svg>
    `;
  }

  const yourGuess = result.guess ?? guessesByCountry.get(key) ?? "";

  elements.history.innerHTML = `
    <h3>Review</h3>

    <div class="review-country-card">

      <div class="review-image">
        ${iconHTML}
      </div>

      <div class="review-info">

        <div>
          <strong>Country:</strong><br>
          ${country.name}
        </div>

        <div>
          <strong>Your guess:</strong><br>
          ${yourGuess}
        </div>

        <div>
          <strong>${
            gameType === "capital"
              ? "Correct capital"
              : "Answer"
          }:</strong><br>
          ${answerText}
        </div>

      </div>

      <div class="review-result ${result.status}">
        ${result.status === "correct"
          ? "✓ Correct"
          : "✗ Wrong"}
      </div>

    </div>
  `;
}
function findGuessForCountry(country) {
  const entries = [...elements.history.children];

  for (const entry of entries) {
    if (entry.textContent.includes(country.name)) {
      const match = entry.textContent.match(/Guess:\s*(.*)/);
      return match ? match[1] : "Unknown";
    }
  }

  return "Unknown";
}

function handleSubmit() {
  if (gameFinished || isAnimating || !currentTarget) {
    return;
  }

  const guess = normalizeName(elements.guessInput.value);
  if (!guess) {
    return;
  }

  

  let guessedCorrectly;
  if (gameType === "capital") {
      guessedCorrectly = isCorrectCapitalGuess(
          elements.guessInput.value,
          currentTarget
      );
  } else {
      guessedCorrectly =
          isCorrectGuess(
              guess,
              currentTarget.normalizedName
          );
  }

  if (guessedCorrectly) {
    correctCount += 1;
    streakCount += 1;
  if (gameType === "capital") {
      elements.feedbackText.textContent =
          `Right. The capital is ${CAPITALS[currentTarget.normalizedName].name}.`;
  } else {
      elements.feedbackText.textContent =
          `Right. It was ${currentTarget.name}.`;
  }
    elements.feedbackText.className = "feedback feedback-good";
  } else {
    streakCount = 0;
    wrongCount += 1;
  if (gameType === "capital") {
      elements.feedbackText.textContent =
          `Wrong. The capital is ${CAPITALS[currentTarget.normalizedName].name}.`;
  } else {
      elements.feedbackText.textContent =
          `Wrong. It was ${currentTarget.name}.`;
  }
    elements.feedbackText.className = "feedback feedback-bad";
  }

  resultByCountry.set(
      countryKey(currentTarget),
      {
          status: guessedCorrectly ? "correct" : "wrong",
          guess: elements.guessInput.value.trim()
      }
  );
  guessesByCountry.set(
    countryKey(currentTarget),
    elements.guessInput.value.trim()
  );
    addHistory(
        elements.guessInput.value.trim(),
        currentTarget,
        guessedCorrectly
    );  
    updateHud();

  drawGlobe(guessedCorrectly ? "correct" : "wrong");
  elements.guessInput.disabled = true;
  elements.submitButton.disabled = true;

  feedbackTimer = window.setTimeout(() => {
    currentRoundIndex += 1;
    elements.guessInput.disabled = false;
    elements.submitButton.disabled = false;
    startRound();
  }, FEEDBACK_DURATION);
}

function finishGame() {
  gameFinished = true;
  elements.guessInput.disabled = true;
  elements.submitButton.disabled = true;

  elements.reviewScoreText.textContent =
    `${correctCount} right, ${wrongCount} wrong.`;

  elements.reviewModal.classList.remove("hidden");
}

function updateHud() {
  elements.roundLabel.textContent = `${currentRoundIndex + 1} / ${roundOrder.length || 1}`;
  elements.scoreLabel.textContent = String(correctCount);
  elements.wrongLabel.textContent = String(wrongCount);
}
function addHistory(guess, country, correct) {
    const row = document.createElement("div");
    row.className =
        "history-entry " + (correct ? "correct" : "wrong");
    let iconHTML;
    let answer;
    if (gameType === "flag") {
        const code = FLAG_CODES[country.normalizedName];
        iconHTML = `
          <img
            class="history-flag"
            src="https://flagcdn.com/w160/${code}.png">
        `;
        answer = country.name;
    } else {
        const miniProjection = d3
            .geoMercator()
            .fitSize([40,40], country);
        const miniPath = d3.geoPath(miniProjection);
        let star = "";
        if (gameType === "capital") {
            const capital = CAPITALS[country.normalizedName];
            if (capital) {
                const p = miniProjection([capital.lon, capital.lat]);
                if (p) {
                    star = `
                        <text
                            x="${p[0]}"
                            y="${p[1] + 3}"
                            text-anchor="middle"
                            font-size="8"
                            fill="#ffd700">★</text>
                    `;
                }
                answer = capital.name;
            } else {
                answer = "Unknown";
            }
        } else {
            answer = country.name;
        }
        iconHTML = `
        <svg
          class="history-icon"
          width="40"
          height="40"
          viewBox="0 0 40 40">
          <path
            d="${miniPath(country)}"
            fill="none"
            stroke="white"
            stroke-width="1.2"/>
          ${star}
        </svg>
        `;
    }
    row.innerHTML = `
        ${iconHTML}

        <div class="history-text">
            <div><strong>Guess:</strong> ${guess}</div>
            <div><strong>Answer:</strong> ${answer}</div>
        </div>

        <div class="history-result">
            ${correct ? "✓" : "✗"}
        </div>
    `;
    elements.history.prepend(row);
}

function drawGlobe(resultState = "neutral") {

  if (gameType !== "country" && !reviewMode ) {
    return;
  } 

  projection.rotate(currentRotation);
  sphereLayer.attr("d", path);
  globeGroup.selectAll("path").filter(function () {
    return d3.select(this).datum() === graticule;
  }).attr("d", path);

  const baseFill = "#a8b3c2";
  const targetFill = resultState === "correct" ? "#2563eb" : resultState === "wrong" ? "#dc2626" : "#f59e0b";

  const landSelection = landLayer.selectAll("path").data(countries, (d) => countryKey(d));

  landSelection
    .join((enter) => enter.append("path").attr("class", "globe-country"))
    .attr("d", path)
    .attr("fill", (d) => {
      const result = resultByCountry.get(countryKey(d));
      const status = result?.status;
      if (status === "correct") {
        return "#2563eb";
      }
      if (status === "wrong") {
        return "#dc2626";
      }
      if (currentTarget && countryKey(d) === countryKey(currentTarget)) {
        return targetFill;
      }
      return baseFill;
    })
    .attr("stroke", (d) => {
      const result = resultByCountry.get(countryKey(d));
      const status = result?.status;
      if (status === "correct" || status === "wrong" || (currentTarget && countryKey(d) === countryKey(currentTarget))) {
        return "#ffffff";
      }
      return "#6b7280";
    })
    .attr("stroke-width", (d) => {
      const result = resultByCountry.get(countryKey(d));
      const status = result?.status;
      return status === "correct" || status === "wrong" || (currentTarget && countryKey(d) === countryKey(currentTarget)) ? 1.4 : 0.8;
    })
    .attr("opacity", (d) => (resultByCountry.has(countryKey(d)) || (currentTarget && countryKey(d) === countryKey(currentTarget)) ? 1 : 0.92));

  if (reviewMode) {
    landLayer.selectAll(".globe-country")
      .style("cursor", "pointer")
      .on("click", function(event, country) {
        showReviewCountry(country);
      });
  }
  outlineLayer.attr("d", path({ type: "Sphere" }));
}

function spinToCountry(country, onDone) {
  const targetCentroid = d3.geoCentroid(country);
  const targetRotation = [-targetCentroid[0], -targetCentroid[1], 0];
  const startRotation = currentRotation.slice();
  const interpolator = d3.interpolate(startRotation, targetRotation);
  let finished = false;

  const completeSpin = () => {
    if (finished) {
      return;
    }

    finished = true;
    currentRotation = targetRotation;
    projection.rotate(currentRotation);
    drawGlobe();
    if (typeof onDone === "function") {
      onDone();
    }
  };

  d3.transition()
    .duration(SPIN_DURATION)
    .ease(d3.easeCubicInOut)
    .tween("rotate", () => (t) => {
      currentRotation = interpolator(t);
      projection.rotate(currentRotation);
      drawGlobe();
    })
    .on("end", completeSpin);

  window.setTimeout(completeSpin, SPIN_DURATION + 80);
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCapital(name) {
  const normalized = normalizeName(name);

  const alias = capitalAliasMap.get(normalized);

  return alias ? normalizeName(alias) : normalized;
}
function capitalKey(country) {
  const capital = CAPITALS[country.normalizedName];
  return capital ? capital.name : "";
}

function isCorrectGuess(guess, normalizedTarget) {
  if (guess === normalizedTarget) {
    return true;
  }

  const mappedGuess = normalizeName(aliasMap.get(guess) || guess);
  if (mappedGuess === normalizedTarget) {
    return true;
  }

  const collapsedGuess = mappedGuess.replace(/\b(the|republic|democratic|people s|peoples|state|states|federation|of)\b/g, "").replace(/\s+/g, " ").trim();
  const collapsedTarget = normalizedTarget.replace(/\b(the|republic|democratic|people s|peoples|state|states|federation|of)\b/g, "").replace(/\s+/g, " ").trim();
  return collapsedGuess === collapsedTarget;
}

function isCorrectCapitalGuess(guess, country) {
  return (
    normalizeCapital(guess) ===
    normalizeCapital(capitalKey(country))
  );
}


function checkMissingFlags() {

  const missing = countries
    .filter(country => !FLAG_CODES[country.normalizedName])
    .map(country => country.name)
    .sort();

  console.log("Missing flags:", missing.length);
  console.table(missing);
}