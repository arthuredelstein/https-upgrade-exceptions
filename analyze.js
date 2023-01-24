import { Level } from 'level';
import minimist from 'minimist';
import url from 'url';
import fs from 'fs';
import { getResponses, createBrowser } from './index.js';

const countErrors = (data) => {
  const statusCodes = data.responses.map(x => x.status);
  const errorCodes = statusCodes.filter(c => (c >= 400));
  //const browserError = data.error ? 1 : 0;
  return errorCodes.length;
};

const getDomains = (filename) => {
  return new Set(fs.readFileSync(filename)
    .toString().trim().split("\n").map(x => x.trim()));
};

const getFalsePositives = () => getDomains("false_positives.dat");

const getKnownExceptions = () => getDomains("https-upgrade-exceptions-list.dat");

const isTimeout = (data) => {
  return data.error && data.error.name === "TimeoutError";
};

const count = async (items) => {
  let n = 0;
  for await (const item of items) {
    ++n;
  }
  return n;
};

const loadDB = (name) => new Level(`${name ?? "results"}.db`,
  { valueEncoding: 'json' });

const urlEssence = (urlString) => {
  const url = new URL(urlString);
  url.search = "";
  const newURL = url.href
    .replace(/^https:\/\//, "")
    .replace(/^http:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^m\./, "")
    .replace(/\/en\/$/, "/")
    .replace(/index\.html$/)
    .replace(/index\.htm$/)
    .replace(/\/$/, "");
  return newURL;
};

const homepageFailed = (test) => {
  const responses = test.responses.filter(r => r.status < 300 || r.status >= 400);
  if (responses.length === 0) {
    return true;
  }
  if (responses[0].status >= 400) {
    return true;
  }
  return false;
};

const suspiciousHttps = (value) => {
  if (value.secure.final_url === "about:blank" ||
    new URL(value.secure.final_url).protocol === "chrome-error:") {
    // We have an error loading HTTPS, so we will fall back correctly.
    return false;
  }
  if (value.insecure.final_url === "about:blank" ||
    new URL(value.insecure.final_url).protocol === "chrome-error:") {
    // HTTP is broken, but it shouldn't matter because we load
    // HTTPS first. If HTTPS fails and we fall back to this broken HTTP, then
    // the whole site is simply broken.
    return false;
  }
  if (homepageFailed(value.secure) && !homepageFailed(value.insecure)) {
    // We're getting an error code in the secure site, but not the same
    // error code on the insecure site.
    return true;
  }
  if (value.secure.responses.length > 10 &&
    value.insecure.responses.length > 10 &&
    value.secure.responses.length + 1 === value.insecure.responses.length &&
    value.insecure.responses[0].status >= 300 &&
    value.insecure.responses[0].status < 400) {
    return false;
  }
  if (urlEssence(value.insecure.final_url) !== urlEssence(value.secure.final_url)) {
    // The destination sites don't match. That looks bad!
    return true;
  }
  return false;
};

const run = async ({ name }) => {
  const t0 = Date.now();
  const db = loadDB(name);
  console.log(`Number of items found: ${await count(db.keys())}`);
  let n = 0;
  const falsePositives = getFalsePositives();
  const knownExceptions = getKnownExceptions();
  try {
    for await (const [key, value] of db.iterator()) {
      const insecureErrorCount = countErrors(value.insecure);
      const secureErrorCount = countErrors(value.secure);
      if (suspiciousHttps(value) && !falsePositives.has(key) && !knownExceptions.has(key)) {
        if (!isTimeout(value.insecure)) {
          ++n;
          console.log(key, value.insecure.final_url, value.secure.final_url, value.insecure.responses.length, value.secure.responses.length, insecureErrorCount, secureErrorCount,
            //JSON.stringify(value.insecure.responses.map(x => x.status)),
            //JSON.stringify(value.secure.responses.map(x => x.status)),
            homepageFailed(value.insecure), homepageFailed(value.secure),
            value.insecure.img_hash, value.secure.img_hash
          );
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
  console.log(`suspicious: ${n}`);
  db.close();
};

if (require.main === module) {
  await run(minimist(process.argv.slice(2)));
}

