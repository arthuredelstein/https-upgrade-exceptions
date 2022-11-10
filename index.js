import * as fs from 'fs';
import puppeteer from 'puppeteer';
import * as readline from 'readline';
import { Level } from 'level';
import minimist from 'minimist';
import { pipeAsync, take } from 'iter-ops';

const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));

const callsToJson = (object, callNames) => {
  const result = {};
  for (const callName of callNames) {
    result[callName] = object[callName]();
  }
  return result;
};

const responseToJson = (responseObject) =>
  callsToJson(responseObject, ['status', 'statusText', 'url']);

const getResponses = async (browser, url) => {
  const responses = [];
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.on('response', interceptedResponse => {
    responses.push(responseToJson(interceptedResponse));
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle2'} );
  } catch (e) {
    return { responses, error: e };
  }
  return { responses };
};

const domainTest = async (browser, domain) => {
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

const asyncPooledProcessor = async function* (asyncIterator, poolSize, asyncFn) {
  const pool = new Set();
  const poolTracker = new Map();
  const getNextResult = async () => {
    const [i, result] = await Promise.race(pool);
    const p = poolTracker.get(i);
    poolTracker.delete(i);
    pool.delete(p);
    return result;
  }
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

const main = async () => {
  const { _: _args, concurrency, name } = minimist(process.argv.slice(2));
  const poolSize = concurrency ? parseInt(concurrency) : 100;
  const t0 = Date.now();
  const browser = await puppeteer.launch({
    headless: true
  });
  const domains = topDomainIterator();
  const db = new Level(`${name ?? "results"}.db`, { valueEncoding: 'json' })
  console.log("ready");
  const results = asyncPooledProcessor(domains, poolSize, async ({number, domain}) => {
    console.log("domainTest:", domain);
    const result = await domainTest(browser, domain);
    console.log("domainTest:", domain, "finished");
    await db.put(domain, result);
    return {number, domain, result};
  });
  let count = 0;
  for await (const result of results) {
    ++count;
    const elapsed = (Date.now() - t0)/1000;
    console.log(elapsed, count, result.number, result.domain, result.result.secure.responses.length, result.result.insecure.responses.length, result.result["error"] === undefined);
  }
//    results.map(({number, domain, result}) => console.log(number, domain, result.insecure.responses.length, result.secure.responses.length));
  await db.close();
  await browser.close();
  const t1 = Date.now();
  console.log("Finished. Elapsed time:", t1 - t0);
};

main();
