const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const UrbanGrowth = require('./models/UrbanGrowth');
const recommendRoutes = require('./routes/recommendationRoutes'); // Import the route

const app = express();
app.use(cors()); // Crucial: Allows your React app (Port 3000) to talk to this API (Port 5000)
app.use(express.json());
app.use('/api/recommend', recommendRoutes); // Define the endpoint

// Replace with your Atlas URI
const mongoURI = "mongodb://127.0.0.1:27017/chennai_urban_growth";

mongoose.connect(mongoURI)
  .then(() => console.log("Backend API connected to MongoDB Atlas"))
  .catch(err => console.error("Database connection error:", err));

// THE ENDPOINT: Your React app will call this
app.get('/api/growth', async (req, res) => {
  try {
    const data = await UrbanGrowth.find();
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error fetching data" });
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));