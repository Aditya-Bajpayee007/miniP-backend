import app from "./index.js";

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
