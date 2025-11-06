import mongoose from "mongoose";

const slideSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    topic: {
      type: String,
      required: true,
    },
    slidesData: [
      {
        imageUrl: {
          type: String,
        },
        textContent: {
          type: String,
          required: true,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Slide = mongoose.model("Slide", slideSchema);

export default Slide;
