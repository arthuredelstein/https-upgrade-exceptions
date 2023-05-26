import { Cluster } from 'puppeteer-cluster';
import { Level } from 'level';
import crypto from 'crypto';
import { getDomains } from './tranco';
import { mkdir, writeFile } from 'node:fs/promises';

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

const getScreenshotHash = async (page) => {
  const image = await page.screenshot({ type: "png" });
  const hash = crypto.createHash('sha256').update(image).digest('hex');
  return hash.substring(0, 16);
};

const fetchResponses = async ({page, url }) => {
  const responses = [];
  page.setDefaultNavigationTimeout(20000);
  page.on('response', interceptedResponse => {
    responses.push(responseToJson(interceptedResponse));
  });
  let errorMessage = null;
  let img_hash = null;
  try {
    await Promise.all(
      [await page.goto(url, { waitUntil: 'load' }),
      await sleep(5000)]);
    img_hash = await getScreenshotHash(page);
  } catch (e) {
    errorMessage = e.message;
  }
  const final_url = page.url();
  return { responses, final_url, errorMessage, img_hash };
};

const runTest = async ({ page, data: { domain, db } }) => {
  try {
    const insecure = await fetchResponses({ page, url: `http://${domain}` });
    const secure = await fetchResponses({ page, url: `https://${domain}` });
    const result = { secure, insecure };
    writeFile(`results_files/${domain}`, JSON.stringify(result));
  } catch (e) {
    console.log(e);
  }
};

const runCluster = async (domains) => {
  mkdir("results_files");

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 32,
    monitor: true
  });
  await cluster.task(runTest);
  for (const domain of domains) {
    cluster.queue({domain, url: domain});
  }
  await cluster.idle();
  await cluster.close();
}

const runCrawl = async (size) => {
  const { domains } = await getDomains(size);
  await runCluster(domains);
}

