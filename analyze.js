import { Level } from 'level';
import minimist from 'minimist';

const countStatusErrors = (responses) => {
  const statusCodes = responses.map(x => x.status);
  const errorCodes = statusCodes.filter(c => (c >= 400))
  return errorCodes.length;
};

const main = async () => {
  const { _: _args, concurrency, name } = minimist(process.argv.slice(2));
  const t0 = Date.now();
  const db = new Level(`${name ?? "results"}.db`, { valueEncoding: 'json' })
  try {
    for await (const [key, value] of db.iterator()) {
      const insecureErrorCount = countStatusErrors(value.insecure.responses);
      const secureErrorCount = countStatusErrors(value.secure.responses);
      if (insecureErrorCount < secureErrorCount) {
        console.log(key, insecureErrorCount, secureErrorCount);
      }
    }
  } catch (err) {
    console.error(err)
  }
  db.close();
};

await main();
