import * as fs from 'fs';
import puppeteer from 'puppeteer';
import * as readline from 'readline';
import { Level } from 'level';
import minimist from 'minimist';
import crypto from 'crypto';
import { create } from 'lodash';
//import { pipeAsync, take } from 'iter-ops';
const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

let db = null;
let gDryRun = false;

const callsToJson = (object, callNames) => {
  const result = {};
  for (const callName of callNames) {
    result[callName] = object[callName]();
  }
  return result;
};

const responseToJson = (responseObject) =>
  callsToJson(responseObject, ['status', 'statusText', 'url']);

const getScreenshotHash = async (page) => {
  const image = await page.screenshot({ type: "png" });
  const hash = crypto.createHash('sha256').update(image).digest('hex');
  return hash.substring(0, 16);
};

export const getResponses = async (browser, url) => {
  const responses = [];
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(20000);
  page.on('response', interceptedResponse => {
    responses.push(responseToJson(interceptedResponse));
  });
  let err = null;
  let img_hash = null;
  try {
    await Promise.all(
      [await page.goto(url, { waitUntil: 'load' }),
      await sleep(5000)]);
    img_hash = await getScreenshotHash(page);
  } catch (e) {
    err = e;
  }
  await page.close();
  return { responses, final_url: page.url(), error: err, img_hash };
};

export const domainTest = async (browser, domain) => {
  const [insecure, secure] = await Promise.all([
    getResponses(browser, `http://${domain}`),
    getResponses(browser, `https://${domain}`)
  ]);
  return { insecure, secure };
};

const topDomainIterator = async function* () {
  const fileStream = fs.createReadStream('top-1m.csv');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const [number, domain] = line.split(',');
    // console.log("line:", number, domain);
    yield { number, domain };
  }
};


const take = async function* (asyncIterator, n) {
  let i = 0;
  for (let i = 0; i < n; ++i) {
    const item = await asyncIterator.next();
    if (!item.done) {
      yield item.value;
    } else {
      break;
    }
  }
};

let domainCount = 0;

const dbHas = async (key) => {
  try {
    await db.get(key);
  } catch (e) {
    if (e.notFound === true) {
      return false;
    }
    throw e;
  }
  return true;
};

const runDomainTestAndSave = async (browser, domain) => {
  if (await dbHas(domain)) {
    // skip
    return;
  }
  const result = await domainTest(browser, domain);
  ++domainCount;
  if (!gDryRun) {
    await db.put(domain, result);
  }
  return domain;
};

export const createBrowser = (headless) => puppeteer.launch(
  { headless: (headless !== false) });

const run = async ({ dryrun, name, poolSize, headless, batchSize }) => {
  gDryRun = dryrun;
  db = new Level(`${name ?? "results"}.db`, { valueEncoding: 'json' });
  poolSize = poolSize ? parseInt(poolSize) : 20;
  batchSize = batchSize ? parseInt(batchSize) : 500;
  const t0 = Date.now();
  const domains = topDomainIterator();
  let count = 0;
  let currentTests = new Map();
  let browser;
  let batchStart = t0;
  for await (const { number, domain } of domains) {
    if (count % batchSize == 0) {
      await Promise.all(currentTests.values());
      currentTests = new Map();
      if (browser) {
        await browser.close();
      }
      const now = Date.now();
      const delta = now - batchStart;
      console.log(`batch elapsed: ${delta}`);
      batchStart = now;
      browser = await createBrowser(headless);
    }
    if (currentTests.size === poolSize) {
      const domain = await Promise.race(currentTests.values());
      currentTests.delete(domain);
    }
    console.log(count, domain);
    currentTests.set(domain, runDomainTestAndSave(browser, domain));
    ++count;
  }
  const t1 = Date.now();
  console.log("Finished. Elapsed time:", t1 - t0);
  await db.close();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  // module was not imported but called directly
  await run(minimist(process.argv.slice(2)));
}

