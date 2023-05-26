import { Cluster } from 'puppeteer-cluster';
import { Level } from 'level';
import crypto from 'crypto';

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

const runTest = async({page, data: {domain, db}}) => {
  try {
  const insecure = await fetchResponses({page, url: `http://${domain}`});
  const secure = await fetchResponses({page, url: `https://${domain}`});
  const result = { secure, insecure };
  console.log({domain, result});
  await db.put(domain, result);
  } catch (e) {
    console.log(e);
  }
};

const runCluster = async () => {
  const db = new Level("results.db", { valueEncoding: 'json' });
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 2,
  });

  await cluster.task(runTest);

  cluster.queue({db, domain: 'google.com'});
  cluster.queue({db, domain: 'wikipedia.org'});

  await cluster.idle();
  await cluster.close();
  await db.close();
}