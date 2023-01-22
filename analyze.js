import { Level } from 'level';
import minimist from 'minimist';

const countErrors = (data) => {
  const statusCodes = data.responses.map(x => x.status);
  const errorCodes = statusCodes.filter(c => (c >= 400));
  //const browserError = data.error ? 1 : 0;
  return errorCodes.length;
};

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

const run = async ({ name }) => {
  const t0 = Date.now();
  const db = loadDB(name);
  console.log(`Number of items found: ${await count(db.keys())}`);
  let n = 0;
  try {
    for await (const [key, value] of db.iterator()) {
      const insecureErrorCount = countErrors(value.insecure);
      const secureErrorCount = countErrors(value.secure);
      if (insecureErrorCount < secureErrorCount && value.insecure.responses.length > 0) {
        if (!isTimeout(value.insecure)) {
          ++n;
          console.log(key, value.insecure.responses.length, value.secure.responses.length, insecureErrorCount, secureErrorCount,
            JSON.stringify(value.insecure.responses.map(x => x.status).filter(x => x >= 400)),
            JSON.stringify(value.secure.responses.map(x => x.status).filter(x => x >= 400)));
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

