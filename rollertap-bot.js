const { chromium } = require("playwright");
const path = require("path");

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function splitCsv(value) {
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// web.telegram.org handles the tg:// deep link internally so Telegram desktop
// is never triggered, even if it is installed on the machine.
const WEB_TELEGRAM_URL =
  "https://web.telegram.org/k/#?tgaddr=" +
  encodeURIComponent(
    "tg://resolve?domain=rollertap_bot&appname=playgame&startapp=5719503390"
  );

const CONFIG = {
  gameUrl: process.env.GAME_URL || WEB_TELEGRAM_URL,
  userDataDir:
    process.env.USER_DATA_DIR || path.join(__dirname, ".pw-user-data"),
  headless: process.env.HEADLESS === "1",
  viewportWidth: Math.max(toInt(process.env.VIEWPORT_WIDTH, 405), 405),
  viewportHeight: Math.max(toInt(process.env.VIEWPORT_HEIGHT, 985), 985),
  clickIntervalMs: toInt(process.env.CLICK_INTERVAL_MS, 45),
  clickJitterPx: toInt(process.env.CLICK_JITTER_PX, 6),
  energyEmptyThreshold: toInt(process.env.ENERGY_EMPTY_THRESHOLD, 0),
  energyCheckEvery: toInt(process.env.ENERGY_CHECK_EVERY, 20),
  // Energy bar appears as 0 \ 10000 in your UI, so keep a high fallback burst
  // in case DOM energy text is temporarily unreadable.
  maxClicksPerBurst: toInt(process.env.MAX_CLICKS_PER_BURST, 12000),
  loopSleepMs: toInt(process.env.LOOP_SLEEP_MS, 20000),
  rechargeEveryMs: toInt(process.env.RECHARGE_EVERY_MS, 60 * 60 * 1000),
  rechargeCooldownMs: toInt(process.env.RECHARGE_COOLDOWN_MS, 10000),
  startupWaitMs: toInt(process.env.STARTUP_WAIT_MS, 30000),
  launchRetryWindowMs: toInt(process.env.LAUNCH_RETRY_WINDOW_MS, 90000),
  launchPollMs: Math.max(toInt(process.env.LAUNCH_POLL_MS, 1200), 300),
  verboseLogs: process.env.VERBOSE_LOGS !== "0",
  clickProgressEvery: Math.max(toInt(process.env.CLICK_PROGRESS_EVERY, 250), 1),
  logTapCoordinates: process.env.LOG_TAP_COORDS === "1",
  tapSelectors: splitCsv(
    process.env.TAP_SELECTORS ||
      "canvas,.tap-area,.tap-zone,[class*=tap],[id*=tap],[class*=click],[id*=click]"
  ),
  rechargeHints: splitCsv(
    process.env.RECHARGE_HINTS ||
      "RECHARGE,recharge,recharger,refill,restore,energy,boost,charge,fill"
  ),
  rechargeSelectors: splitCsv(
    process.env.RECHARGE_SELECTORS ||
      "[class*=recharge],[id*=recharge],[class*=boost],[id*=boost]"
  ),
  confirmHints: splitCsv(
    process.env.CONFIRM_HINTS ||
      "confirm,use,ok,claim,activate,activer,utiliser,continuer"
  ),
};

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(message) {
  console.log(`[${now()}] ${message}`);
}

function vlog(message) {
  if (!CONFIG.verboseLogs) return;
  log(`[DEBUG] ${message}`);
}

function frameLabel(frame) {
  const url = frame?.url?.() || "";
  if (!url) return "frame:url-vide";
  if (url.length > 100) return `${url.slice(0, 97)}...`;
  return url;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base, range) {
  return base + (Math.random() * 2 - 1) * range;
}

// Click the "Launch" / "Play" button shown by Telegram Web when opening a
// mini-app.  Also dismisses any privacy/confirmation overlay that may appear.
async function launchMiniApp(page) {
  vlog("Recherche du bouton Launch/Play dans Telegram Web.");

  const launchTexts = [
    "Launch",
    "Lancer",
    "Play",
    "Jouer",
    "Open",
    "Ouvrir",
    "Start",
    "Demarrer",
    "Continue",
    "Continuer",
  ];

  for (const frame of getAllFrames(page)) {
    for (const text of launchTexts) {
      try {
        vlog(`Tentative launch avec texte "${text}" sur ${frameLabel(frame)}.`);

        const btn = frame
          .locator(`button:has-text("${text}"), [role=button]:has-text("${text}")`)
          .first();
        const visible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
        if (!visible) continue;

        await btn.click({ force: true });
        log(`Mini-app lancee via bouton "${text}".`);
        vlog("Attente de l'iframe mini-app apres clic Launch/Play.");

        // Wait for the game iframe to appear.
        await page
          .waitForSelector("iframe", { timeout: 15000 })
          .catch(() => {});
        return true;
      } catch (error) {
        vlog(`Erreur pendant launch "${text}": ${error.message}`);
        // Try the next option.
      }
    }
  }

  vlog("Bouton launch/play non trouve pour cette tentative.");
  return false;
}

function isGameLikeFrame(frame) {
  const url = frame.url() || "";
  return (
    !!url &&
    !url.startsWith("about:") &&
    !url.includes("web.telegram.org") &&
    !url.includes("telegram.org")
  );
}

// Return the page or the first iframe that looks like the actual game.
// Falls back to the main page if no game-like iframe is found.
async function findGameFrame(page) {
  const frames = page.frames();
  vlog(`Analyse de ${frames.length} frame(s) pour identifier la mini-app.`);

  for (const frame of frames) {
    if (isGameLikeFrame(frame)) {
      vlog(`Frame mini-app candidate: ${frame.url()}`);
      return frame;
    }
  }

  vlog("Aucune frame mini-app specifique detectee, fallback sur la frame principale.");
  return page.mainFrame();
}

function hasGameFrame(page) {
  return page.frames().some((frame) => isGameLikeFrame(frame));
}

function getAllFrames(page) {
  const main = page.mainFrame();
  const others = page.frames().filter((f) => f !== main);

  const gameFrames = others.filter((frame) => isGameLikeFrame(frame));
  const otherFrames = others.filter((frame) => !isGameLikeFrame(frame));
  return [...gameFrames, main, ...otherFrames];
}

async function clickTelegramLaunchConsent(page) {
  const consentTexts = [
    "LANCER",
    "LAUNCH",
    "Launch",
    "Lancer",
    "Open",
    "Ouvrir",
    "Continuer",
    "Continue",
  ];

  for (const frame of getAllFrames(page)) {
    try {
      const hasConsentMessage = await frame
        .evaluate(() => {
          const text = (document.body?.innerText || "").toLowerCase();
          return (
            text.includes("lancer cette application web") ||
            text.includes("launch this web app") ||
            text.includes("connected to its website") ||
            text.includes("connecte a son site web")
          );
        })
        .catch(() => false);

      if (hasConsentMessage) {
        vlog(`Popup de confirmation mini-app detecte sur ${frameLabel(frame)}.`);
      }

      for (const label of consentTexts) {
        const selectors = [
          `button:has-text("${label}")`,
          `[role=button]:has-text("${label}")`,
          `text=/^\\s*${label}\\s*$/i`,
          `text=${label}`,
        ];

        for (const selector of selectors) {
          const btn = frame.locator(selector).first();
          const visible = await btn.isVisible().catch(() => false);
          if (!visible) continue;

          await btn.click({ force: true, timeout: 2000 });
          log(`Confirmation mini-app cliquee via "${label}".`);
          return true;
        }
      }
    } catch (error) {
      vlog(`Erreur pendant recherche popup consentement: ${error.message}`);
    }
  }

  return false;
}

async function ensureMiniAppStarted(page) {
  const deadline = Date.now() + CONFIG.launchRetryWindowMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    vlog(`Demarrage mini-app, tentative #${attempt}.`);

    if (hasGameFrame(page)) {
      vlog("Mini-app deja detectee via iframe de jeu.");
      return true;
    }

    const consentClicked = await clickTelegramLaunchConsent(page);
    if (consentClicked) {
      await sleep(900);
      if (hasGameFrame(page)) {
        vlog("Mini-app detectee apres validation du popup LANCER.");
        return true;
      }
    }

    const launched = await launchMiniApp(page);
    if (launched) {
      await sleep(1200);
      // A consent popup may appear after first launch click; retry once immediately.
      await clickTelegramLaunchConsent(page).catch(() => {});
      await sleep(1000);

      if (hasGameFrame(page)) {
        vlog("Mini-app detectee apres sequence Launch + confirmation.");
        return true;
      }
    }

    await sleep(CONFIG.launchPollMs);
  }

  log(
    "Timeout de lancement mini-app: popup LANCER potentiellement non valide automatiquement."
  );
  return hasGameFrame(page);
}

async function readEnergy(page) {
  for (const frame of getAllFrames(page)) {
    try {
      const result = await frame.evaluate(() => {
        if (!document.body) return null;

        const text = document.body.innerText || "";
        if (!text) return null;

        const ratioTextPattern =
          /(\d{1,6}(?:[ .,_]\d{3})?)\s*([\/\\|])\s*(\d{1,6}(?:[ .,_]\d{3})?)/;
        const keywordPattern =
          /(energy|energie|energia|energi|lightning)[^\n]{0,60}?(\d{1,6}(?:[ .,_]\d{3})?\s*[\/\\|]\s*\d{1,6}(?:[ .,_]\d{3})?)/i;
        const keywordMatch = text.match(keywordPattern);

        const parseRatio = (raw) => {
          const ratioMatch = raw.match(ratioTextPattern);
          if (!ratioMatch) return null;

          const current = Number.parseInt(ratioMatch[1].replace(/\D/g, ""), 10);
          const max = Number.parseInt(ratioMatch[3].replace(/\D/g, ""), 10);
          if (!Number.isFinite(current) || !Number.isFinite(max)) return null;
          if (current > max) return null;
          return { current, max };
        };

        if (keywordMatch?.[2]) {
          const parsed = parseRatio(keywordMatch[2]);
          if (parsed) return { ...parsed, source: "keyword" };
        }

        const genericMatch = text.match(
          /\d{1,6}(?:[ .,_]\d{3})?\s*[\/\\|]\s*\d{1,6}(?:[ .,_]\d{3})?/
        );
        if (genericMatch?.[0]) {
          const parsed = parseRatio(genericMatch[0]);
          if (parsed) return { ...parsed, source: "generic" };
        }

        return null;
      });

      if (result) {
        vlog(
          `Energie lue: ${result.current}/${result.max} (${result.source}) sur ${frameLabel(frame)}.`
        );
        return {
          ...result,
          frameUrl: frame.url(),
        };
      }
    } catch (error) {
      // Ignore frame parse errors and continue scanning others.
    }
  }

  return null;
}

async function findTapArea(page) {
  vlog("Recherche de la zone de tap...");

  for (const frame of getAllFrames(page)) {
    for (const selector of CONFIG.tapSelectors) {
      try {
        const locator = frame.locator(selector).first();
        if ((await locator.count()) === 0) continue;

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;

        const box = await locator.boundingBox();
        if (!box) continue;

        if (box.width >= 80 && box.height >= 80) {
          vlog(
            `Zone de tap detectee via "${selector}" sur ${frameLabel(frame)} (x=${box.x.toFixed(1)}, y=${box.y.toFixed(1)}, w=${box.width.toFixed(1)}, h=${box.height.toFixed(1)}).`
          );
          return {
            selector,
            frameUrl: frame.url(),
            box,
          };
        }
      } catch (error) {
        // Ignore selector errors and keep searching.
      }
    }
  }

  const viewport = page.viewportSize();
  if (!viewport) return null;

  vlog("Zone de tap non detectee via selecteurs, utilisation du fallback viewport.");

  return {
    selector: "viewport-fallback",
    frameUrl: page.url(),
    box: {
      x: viewport.width * 0.2,
      y: viewport.height * 0.2,
      width: viewport.width * 0.6,
      height: viewport.height * 0.6,
    },
  };
}

async function clickButtonByText(frame, hint, context = "") {
  const contextSuffix = context ? ` [${context}]` : "";

  const selectors = [
    `button:has-text("${hint}")`,
    `[role=button]:has-text("${hint}")`,
    `a:has-text("${hint}")`,
    `text=${hint}`,
  ];

  vlog(`Recherche bouton "${hint}"${contextSuffix} sur ${frameLabel(frame)}.`);

  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if ((await locator.count()) === 0) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    await locator.click({ timeout: 1500, force: true });
    vlog(`Clique "${hint}" via ${selector}${contextSuffix}.`);
    return true;
  }

  vlog(`Bouton "${hint}" introuvable${contextSuffix}.`);
  return false;
}

async function attemptRecharge(page) {
  vlog("Debut de la tentative de recharge.");

  for (const frame of getAllFrames(page)) {
    vlog(`Scan recharge sur ${frameLabel(frame)}.`);

    // Direct match for the exact button observed in your capture.
    try {
      const rechargeBtn = frame
        .locator("button:has-text(\"RECHARGE\"), [role=button]:has-text(\"RECHARGE\"), text=/^\\s*RECHARGE\\s*$/i")
        .first();
      const visible = await rechargeBtn.isVisible().catch(() => false);
      if (visible) {
        await rechargeBtn.click({ timeout: 1500, force: true });
        log('Recharge bouton clique via texte exact "RECHARGE".');

        await sleep(500);
        for (const hint of CONFIG.confirmHints) {
          await clickButtonByText(frame, hint, "confirm-post-recharge").catch(() => {});
        }

        return true;
      }

      vlog('Bouton exact "RECHARGE" non visible sur cette frame.');
    } catch (error) {
      vlog(`Erreur pendant recherche du bouton exact RECHARGE: ${error.message}`);
      // Continue with hint/selectors fallback.
    }

    for (const hint of CONFIG.rechargeHints) {
      try {
        const clicked = await clickButtonByText(frame, hint, "recharge-hint");
        if (!clicked) continue;

        // Some mini-apps ask for a confirmation click after opening the boost popup.
        await sleep(500);
        for (const confirmHint of CONFIG.confirmHints) {
          await clickButtonByText(frame, confirmHint, "confirm-post-hint").catch(() => {});
        }

        log(`Recharge bouton clique via hint "${hint}".`);
        return true;
      } catch (error) {
        vlog(`Erreur lors du hint recharge "${hint}": ${error.message}`);
        // Try next hint.
      }
    }

    for (const selector of CONFIG.rechargeSelectors) {
      try {
        const locator = frame.locator(selector).first();
        if ((await locator.count()) === 0) continue;

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;

        await locator.click({ timeout: 1500, force: true });
        log(`Recharge bouton clique via selector "${selector}".`);
        return true;
      } catch (error) {
        vlog(`Erreur sur selector recharge "${selector}": ${error.message}`);
        // Try next selector.
      }
    }
  }

  vlog("Recharge non trouvee sur toutes les frames analysees.");
  return false;
}

async function tapUntilEnergyEmpty(page) {
  const tapArea = await findTapArea(page);
  if (!tapArea) {
    log("Zone de clic introuvable.");
    return { clicks: 0, depleted: false, energy: null };
  }

  const centerX = tapArea.box.x + tapArea.box.width / 2;
  const centerY = tapArea.box.y + tapArea.box.height / 2;
  const jitterX = Math.min(CONFIG.clickJitterPx, tapArea.box.width / 3);
  const jitterY = Math.min(CONFIG.clickJitterPx, tapArea.box.height / 3);

  vlog(
    `Debut cycle de tap sur ${tapArea.selector} (frame=${tapArea.frameUrl || "n/a"}, centre=${centerX.toFixed(1)},${centerY.toFixed(1)}, jitter=${jitterX.toFixed(1)}x${jitterY.toFixed(1)}).`
  );

  let clicks = 0;
  let lastEnergy = await readEnergy(page);

  if (lastEnergy) {
    log(
      `Energie detectee: ${lastEnergy.current}/${lastEnergy.max} (source: ${lastEnergy.source}).`
    );
  } else {
    vlog("Energie non detectee au debut du cycle.");
  }

  for (let i = 1; i <= CONFIG.maxClicksPerBurst; i += 1) {
    const x = jitter(centerX, jitterX);
    const y = jitter(centerY, jitterY);

    await page.mouse.click(x, y);
    clicks = i;

    if (CONFIG.clickIntervalMs > 0) {
      await sleep(CONFIG.clickIntervalMs);
    }

    if (i % CONFIG.clickProgressEvery === 0) {
      if (CONFIG.logTapCoordinates) {
        vlog(
          `Progression clics: ${i}/${CONFIG.maxClicksPerBurst} (dernier clic x=${x.toFixed(1)}, y=${y.toFixed(1)}).`
        );
      } else {
        vlog(`Progression clics: ${i}/${CONFIG.maxClicksPerBurst}.`);
      }
    }

    if (i % CONFIG.energyCheckEvery !== 0) continue;

    const energy = await readEnergy(page);
    if (!energy) {
      vlog(`Check energie apres ${i} clics: ratio introuvable dans le DOM.`);
      continue;
    }

    vlog(
      `Check energie apres ${i} clics: ${energy.current}/${energy.max} (source=${energy.source}).`
    );

    lastEnergy = energy;
    if (energy.current <= CONFIG.energyEmptyThreshold) {
      log(`Energie vide detectee a ${energy.current}/${energy.max}.`);
      return { clicks, depleted: true, energy: energy };
    }
  }

  return {
    clicks,
    depleted: false,
    energy: lastEnergy,
  };
}

async function run() {
  log("Demarrage du bot RollerTap.");
  log(
    `Logs detailles ${CONFIG.verboseLogs ? "actifs" : "desactives"} (VERBOSE_LOGS=${CONFIG.verboseLogs ? "1" : "0"}).`
  );
  vlog(
    `Config: headless=${CONFIG.headless ? "1" : "0"}, clickIntervalMs=${CONFIG.clickIntervalMs}, energyCheckEvery=${CONFIG.energyCheckEvery}, maxClicksPerBurst=${CONFIG.maxClicksPerBurst}, rechargeEvery=${formatDuration(CONFIG.rechargeEveryMs)}.`
  );

  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: CONFIG.headless,
    viewport: {
      width: CONFIG.viewportWidth,
      height: CONFIG.viewportHeight,
    },
    args: [
      "--disable-blink-features=AutomationControlled",
      `--window-size=${CONFIG.viewportWidth},${CONFIG.viewportHeight}`,
    ],
  });

  const page = context.pages()[0] || (await context.newPage());

  process.on("SIGINT", async () => {
    log("Arret demande (CTRL+C). Fermeture du navigateur...");
    await context.close();
    process.exit(0);
  });

  await page.goto(CONFIG.gameUrl, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page.setViewportSize({
    width: CONFIG.viewportWidth,
    height: CONFIG.viewportHeight,
  });

  log("Page web.telegram.org ouverte.");
  log(
    `Fenetre reglee sur ${CONFIG.viewportWidth}x${CONFIG.viewportHeight}.`
  );
  log("Connecte ton compte Telegram dans la fenetre si ce n'est pas deja fait.");
  log(`Attente de ${CONFIG.startupWaitMs / 1000}s pour le chargement de Telegram Web...`);
  await sleep(CONFIG.startupWaitMs);

  log(
    `Tentative de lancement mini-app pendant ${formatDuration(CONFIG.launchRetryWindowMs)} (gestion popup LANCER incluse).`
  );
  const miniAppLaunched = await ensureMiniAppStarted(page);
  if (!miniAppLaunched) {
    log("Mini-app non lancee automatiquement. Ouvre-la manuellement puis laisse le bot tourner.");
  }

  // Wait a bit for the game iframe to fully load.
  await sleep(5000);
  const gameFrame = await findGameFrame(page);
  log(`Jeu detecte sur: ${gameFrame.url() || "frame principal"}.`);

  let nextRechargeAt = Date.now() + CONFIG.rechargeEveryMs;
  let cycleNumber = 0;

  while (true) {
    try {
      cycleNumber += 1;
      const nowMs = Date.now();
      const msBeforeRecharge = Math.max(0, nextRechargeAt - nowMs);
      log(
        `Debut cycle #${cycleNumber}. Prochaine recharge auto dans ${formatDuration(msBeforeRecharge)}.`
      );

      if (nowMs >= nextRechargeAt) {
        log("Tentative de recharge horaire...");
        const recharged = await attemptRecharge(page);
        log(recharged ? "Recharge terminee." : "Recharge non trouvee.");
        nextRechargeAt = nowMs + CONFIG.rechargeEveryMs;
        await sleep(CONFIG.rechargeCooldownMs);
      }

      const cycle = await tapUntilEnergyEmpty(page);
      if (cycle.clicks === 0) {
        log("Aucun clic effectif envoye, nouvelle tentative au prochain cycle.");
      } else if (cycle.depleted) {
        log(`Cycle termine: ${cycle.clicks} clics, energie vide.`);
      } else {
        log(`Cycle termine: ${cycle.clicks} clics, energie non confirmee vide.`);
      }
    } catch (error) {
      log(`Erreur dans la boucle: ${error.message}`);
    }

    log(`Pause ${formatDuration(CONFIG.loopSleepMs)} avant le cycle suivant.`);
    await sleep(CONFIG.loopSleepMs);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
