(async function () {
  try {
    const res = await fetch("http://127.0.0.1:8787/api/auth/login", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip",
      },
      body: JSON.stringify({
        email: "admin@tagsakay.com",
        password: "admin123",
      }),
    });

    console.log("status", res.status);
    console.log("headers", Object.fromEntries(res.headers.entries()));

    const bodyText = await res.text();
    console.log("dataType", typeof bodyText);
    console.log("dataLength", bodyText.length);
    console.log("dataPreview", bodyText.slice(0, 200));
  } catch (err) {
    console.error("fetch error", err);
  }
})();
