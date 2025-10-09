const WORKER = process.env.WORKER_URL || "http://127.0.0.1:8787";

const test = async () => {
  const endpoint = new URL("/api/checkout/one-time", WORKER);

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 300, currency: "eur" })
    });

    const json = await r.json();
    console.log(json);
  } catch (err) {
    console.error("Request failed:", err);
  }
};

test();
