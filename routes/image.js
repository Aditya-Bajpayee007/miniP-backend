import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/search", async (req, res) => {
  const { q } = req.query;

  if (!q) return res.status(400).json({ error: "Missing query" });

  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_images",
        q,
        api_key: process.env.SERPAPI_API_KEY,
        hl: "en",
        gl: "us",
        ijn: 0,
      },
    });

    // Log top-level keys to help debugging different SERPAPI shapes
    console.log("SerpAPI response keys:", Object.keys(response.data || {}));

    const imgs = response.data.images_results || response.data.image_results || [];

    let firstImage = null;

    if (Array.isArray(imgs) && imgs.length > 0) {
      const candidate = imgs[0];
      // Try several likely fields in order of preference
      firstImage =
        candidate.original ||
        candidate.source ||
        candidate.thumbnail ||
        candidate.link ||
        candidate.url ||
        candidate.image ||
        null;
    }

    // As a last resort, scan the array for any entry with a usable url-like field
    if (!firstImage && Array.isArray(imgs)) {
      for (const c of imgs) {
        const val = c.original || c.source || c.thumbnail || c.link || c.url || c.image;
        if (val) {
          firstImage = val;
          break;
        }
      }
    }

    res.json({ image: firstImage || null });
  } catch (err) {
    console.error("SerpAPI error:", err?.message || err);
    // Provide small hint in response for debugging (not leaking sensitive data)
    res.status(500).json({ error: "SerpAPI search failed" });
  }
});

// @desc    Enhance image using Stable Diffusion model
// @route   POST /api/image/enhance
// @access  Public (can be restricted if needed)
router.post("/enhance", async (req, res) => {
  try {
    const { image_url, prompt } = req.body;

    if (!image_url || !prompt) {
      return res
        .status(400)
        .json({ error: "Missing image_url or prompt" });
    }

    const SD_MODEL_ENDPOINT = process.env.SD_MODEL_ENDPOINT || 
      "https://subrepand-avowed-malvina.ngrok-free.dev";

    // Download the image from URL with proper headers
    let imageData;
    try {
      const imgResponse = await axios.get(image_url, {
        responseType: "arraybuffer",
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        maxRedirects: 5,
      });
      imageData = Buffer.from(imgResponse.data).toString("base64");
      console.log(`✅ Downloaded image for enhancement`);
    } catch (imgErr) {
      console.error("Failed to download image:", imgErr?.message);
      return res.status(400).json({ 
        error: "Failed to download image from URL",
        details: imgErr?.message 
      });
    }

    // Try img2img endpoint with correct path /sdapi/v1/img2img
    try {
      console.log(`Attempting img2img at ${SD_MODEL_ENDPOINT}/sdapi/v1/img2img`);
      
      const response = await axios.post(
        `${SD_MODEL_ENDPOINT}/sdapi/v1/img2img`,
        {
          // Image input
          init_images: [imageData], // Base64 encoded image
          
          // Text prompts
          prompt: prompt,
          negative_prompt: "blurry, low quality, distorted, ugly, artifacts",
          
          // Subtle modification parameters
          denoising_strength: 0.25, // Very low - only 10% modification
          steps: 12, // Fewer refinement steps
          cfg_scale: 4, // Low prompt adherence, preserves original
          image_cfg_scale: 2.0, // High weight to original image
          
          // Sampler settings
          sampler_name: "Euler", // Simple, predictable sampler
          scheduler: "normal",
          sampler_index: "Euler",
          
          // Seed control
          seed: -1,
          subseed: -1,
          subseed_strength: 0,
          seed_resize_from_h: -1,
          seed_resize_from_w: -1,
          
          // Noise control
          initial_noise_multiplier: 0.6, // Low noise for subtle changes
          s_min_uncond: 0,
          s_churn: 0,
          s_tmax: 0,
          s_tmin: 0,
          s_noise: 0,
          
          // Image dimensions
          width: 512,
          height: 512,
          resize_mode: 0, // Just resize, don't crop
          
          // Enhancement options
          restore_faces: true, // Improve face quality
          tiling: false, // Don't tile
          
          // Batch settings
          batch_size: 1,
          n_iter: 1,
          
          // Output settings
          eta: 0,
          do_not_save_samples: false,
          do_not_save_grid: false,
          save_images: false,
          send_images: true,
          include_init_images: false, // Only return modified image
          
          // Inpainting disabled
          inpainting_fill: 0,
          inpaint_full_res: false,
          inpaint_full_res_padding: 0,
          inpainting_mask_invert: 0,
          
          // Other settings
          override_settings_restore_afterwards: true,
          disable_extra_networks: false,
          force_task_id: "",
          script_name: "",
          script_args: [],
          comments: {},
          styles: [],
          alwayson_scripts: {},
        },
        {
          timeout: 120000,
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
          },
        }
      );

      // Check for images in response
      if (response.data && response.data.images && response.data.images.length > 0) {
        const enhancedImage = response.data.images[0];
        console.log(`✅ img2img enhancement successful`);
        
        return res.json({
          image: `data:image/png;base64,${enhancedImage}`,
          image_url: `data:image/png;base64,${enhancedImage}`,
          success: true,
          method: "img2img",
        });
      }

      console.error("img2img returned unexpected format");
      return res.json({
        image: image_url,
        image_url: image_url,
        success: true,
        method: "fallback",
        note: "img2img returned unexpected format, using original image",
      });

    } catch (img2imgErr) {
      console.warn(`img2img failed: ${img2imgErr?.response?.status} - ${img2imgErr?.message}`);
      
      // Fallback to txt2img
      try {
        console.log(`Attempting txt2img fallback at ${SD_MODEL_ENDPOINT}/sdapi/v1/txt2img`);
        
        const txt2imgResponse = await axios.post(
          `${SD_MODEL_ENDPOINT}/sdapi/v1/txt2img`,
          {
            prompt: prompt,
            negative_prompt: "blurry, low quality, distorted, ugly",
            steps: 20,
            cfg_scale: 7,
            width: 512,
            height: 512,
            sampler_name: "DPM++ 2M Karras",
            scheduler: "karras",
            seed: -1,
            restore_faces: true,
            tiling: false,
            eta: 0,
          },
          {
            timeout: 120000,
            headers: {
              "Content-Type": "application/json",
              "ngrok-skip-browser-warning": "true",
            },
          }
        );

        if (txt2imgResponse.data && txt2imgResponse.data.images && txt2imgResponse.data.images.length > 0) {
          const generatedImage = txt2imgResponse.data.images[0];
          console.log(`✅ txt2img generation successful (fallback)`);
          
          return res.json({
            image: `data:image/png;base64,${generatedImage}`,
            image_url: `data:image/png;base64,${generatedImage}`,
            success: true,
            method: "txt2img",
            note: "Generated from prompt as img2img unavailable",
          });
        }

        console.error("txt2img returned unexpected format");
        return res.json({
          image: image_url,
          image_url: image_url,
          success: true,
          method: "fallback",
          note: "SD models unavailable, using original image",
        });
      } catch (txt2imgErr) {
        console.error(`txt2img also failed: ${txt2imgErr?.message}`);
        
        // Final fallback: return original image
        return res.json({
          image: image_url,
          image_url: image_url,
          success: true,
          method: "fallback",
          note: "SD models unavailable, using original SerpAPI image",
        });
      }
    }

  } catch (err) {
    console.error("Endpoint error:", err?.message);
    
    // Return original image even on error
    const imageUrl = req.body?.image_url;
    if (imageUrl) {
      return res.json({
        image: imageUrl,
        image_url: imageUrl,
        success: true,
        method: "error-fallback",
        error: err?.message,
      });
    }
    
    res.status(500).json({
      error: "Image processing failed",
      details: err?.message,
    });
  }
});

export default router;
