import * as fs from 'fs';
import puppeteer from 'puppeteer';
import * as readline from 'readline';
import { Level } from 'level';
import minimist from 'minimist';
//import { pipeAsync, take } from 'iter-ops';
const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

let browser = null;
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

const getResponses = async (url) => {
  const responses = [];
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.on('response', interceptedResponse => {
    responses.push(responseToJson(interceptedResponse));
  });
  try {
    await page.goto(url, {
      waitUntil: 'networkidle2'
    });
  } catch (e) {
    await page.close();
    return { responses, error: e };
  }
  await page.close();
  return { responses, final_url: p.url() };
};

const domainTest = async (domain) => {
  const [insecure, secure] = await Promise.all([
    getResponses(`http://${domain}`),
    getResponses(`https://${domain}`)
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

const asyncPooledProcessor = async function* (asyncIterator, asyncFn, poolSize) {
  const pool = new Set();
  const poolTracker = new Map();
  const getNextResult = async () => {
    const [i, result] = await Promise.race(pool);
    const p = poolTracker.get(i);
    poolTracker.delete(i);
    pool.delete(p);
    return result;
  };
  let index = 0;
  const queueItem = (item) => {
    ++index;
    const promise = (async () => [index, await asyncFn(item)])();
    pool.add(promise);
    poolTracker.set(index, promise);
  };
  for await (const item of asyncIterator) {
    queueItem(item);
    if (pool.size === poolSize) {
      yield await getNextResult();
    }
  }
  while (pool.size > 0) {
    yield await getNextResult();
  }
};

let domainCount = 0;

const runDomainTestAndSave = async (domain) => {
  const result = await domainTest(domain);
  ++domainCount; 
  console.log(`domainTest ${domainCount}: ${domain}`);
  if (!gDryRun) {
    //console.log("put", domain);
    await db.put(domain, result);
  }
  return result;
};

const run = async ({ dryrun, name, poolSize, headless, batchSize }) => {
  db = new Level(`${name ?? "results"}.db`, { valueEncoding: 'json' });
  poolSize = poolSize ? parseInt(poolSize) : 32;
  batchSize = batchSize ? parseInte(batchSize) : 10000;
  const t0 = Date.now();
  const domains = topDomainIterator();
  while (true) {
    console.log("new browser");
    browser = await puppeteer.launch({ headless: (headless !== false) });
    const domainBatch = take(domains, batchSize);
    const results = asyncPooledProcessor(
      domainBatch, ({ domain }) =>
      runDomainTestAndSave(domain), poolSize);
    for await (const result of results) {
      const elapsed = (Date.now() - t0) / 1000;
      //      console.log(result);
    }
    await browser.close();
  }
  const t1 = Date.now();
  console.log("Finished. Elapsed time:", t1 - t0);
  await db.close();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  // module was not imported but called directly
  await run(minimist(process.argv.slice(2)));
}

