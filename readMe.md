# Backend Service for miniP

This is the backend service for the miniProject application. It is built with Node.js, Express, and MongoDB.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

- Node.js
- npm
- MongoDB

### Installing

1. Clone the repository:
   ```sh
   git clone https://github.com/Aditya-Bajpayee007/miniP.git
   ```
2. Navigate to the backend directory:
   ```sh
   cd backend
   ```
3. Install the dependencies:
   ```sh
   npm install
   ```
4. Create a `.env` file in the `backend` directory and add the following environment variables:
   ```
   GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   SERPAPI_API_KEY="YOUR_SERPAPI_API_KEY"
   MONGO_URI="YOUR_MONGO_URI"
   ACCESS_TOKEN_SECRET="YOUR_ACCESS_TOKEN_SECRET"
   REFRESH_TOKEN_SECRET="YOUR_REFRESH_TOKEN_SECRET"
   ```
5. Start the server:
   ```sh
   npm run dev
   ```

The server will be running on `http://localhost:3000`.

## API Endpoints

The following are the available API endpoints:

- `/api/image`: Image related routes.
- `/api/youtube`: YouTube related routes.
- `/api/auth`: Authentication related routes.
- `/api/user`: User related routes.
- `/api/slides`: Slide management related routes.

## Built With

- [Node.js](https://nodejs.org/) - The JavaScript runtime used.
- [Express](https://expressjs.com/) - The web framework used.
- [MongoDB](https://www.mongodb.com/) - The database used.
- [Mongoose](https://mongoosejs.com/) - The MongoDB object modeling tool used.
- [JWT](https://jwt.io/) - Used for authentication.
