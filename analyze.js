import { Level } from 'level';
import minimist from 'minimist';

const countErrors = (data) => {
  const statusCodes = data.responses.map(x => x.status);
  const errorCodes = statusCodes.filter(c => (c >= 400))
  //const browserError = data.error ? 1 : 0;
  return errorCodes.length;
};

const isTimeout = (data) => {
  return data.error && data.error.name === "TimeoutError";
};

const countKeys = async (keys) => {
  let n = 0;
  for await (const key of keys) {
    ++n;
  }
  return n;
};

const run = async ({concurrency, name}) => {
  const t0 = Date.now();
  const db = new Level(`${name ?? "results"}.db`, { valueEncoding: 'json' })
  console.log(await countKeys(db.keys()));
  try {
    for await (const [key, value] of db.iterator()) {
      const insecureErrorCount = countErrors(value.insecure);
      const secureErrorCount = countErrors(value.secure);
      if (insecureErrorCount < secureErrorCount && value.insecure.responses.length > 0) {
        if (!isTimeout(value.insecure)) {
          console.log(key, insecureErrorCount, secureErrorCount);
        }
      }
    }
  } catch (err) {
    console.error(err)
  }
  db.close();
};

if (require.main === module) {
  await run(minimist(process.argv.slice(2)));
}

