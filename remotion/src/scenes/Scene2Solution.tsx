import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: titleFont } = loadSpaceGrotesk("normal", { weights: ["700"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadInter("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const Scene2Solution: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame: frame - 10, fps, config: { damping: 15, stiffness: 120 } });
  const logoOpacity = interpolate(logoScale, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });

  const taglineProgress = spring({ frame: frame - 40, fps, config: { damping: 200 } });
  const taglineOpacity = interpolate(taglineProgress, [0, 1], [0, 1]);
  const taglineY = interpolate(taglineProgress, [0, 1], [30, 0]);

  const subtitleProgress = spring({ frame: frame - 60, fps, config: { damping: 200 } });
  const subtitleOpacity = interpolate(subtitleProgress, [0, 1], [0, 1]);

  // Subtle line decoration
  const lineWidth = interpolate(frame, [25, 55], [0, 300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #171D2A 0%, #1A2540 50%, #171D2A 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Truck icon SVG */}
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
            marginBottom: 24,
          }}
        >
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <rect x="5" y="25" width="45" height="30" rx="4" fill="#2256B3" />
            <rect x="50" y="32" width="22" height="23" rx="3" fill="#2256B3" />
            <polygon points="72,42 78,50 72,55" fill="#1A3F8F" />
            <circle cx="22" cy="58" r="7" fill="#F5A623" />
            <circle cx="22" cy="58" r="3" fill="#171D2A" />
            <circle cx="62" cy="58" r="7" fill="#F5A623" />
            <circle cx="62" cy="58" r="3" fill="#171D2A" />
          </svg>
        </div>

        {/* Logo text */}
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        >
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 96,
              fontWeight: 700,
              color: "#FFFFFF",
              letterSpacing: -2,
            }}
          >
            Movi
          </span>
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 96,
              fontWeight: 700,
              color: "#F5A623",
              letterSpacing: -2,
            }}
          >
            Log
          </span>
        </div>

        {/* Decorative line */}
        <div
          style={{
            width: lineWidth,
            height: 2,
            background: "linear-gradient(90deg, transparent, #2256B3, transparent)",
            margin: "16px auto",
          }}
        />

        {/* Tagline */}
        <div
          style={{
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            marginTop: 8,
          }}
        >
          <span
            style={{
              fontFamily: bodyFont,
              fontSize: 36,
              color: "rgba(255,255,255,0.9)",
              fontWeight: 500,
            }}
          >
            El flujo logístico en un solo lugar
          </span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            opacity: subtitleOpacity,
            marginTop: 16,
          }}
        >
          <span
            style={{
              fontFamily: bodyFont,
              fontSize: 22,
              color: "rgba(255,255,255,0.5)",
              fontWeight: 400,
            }}
          >
            Pedidos · Despacho · Seguimiento · Control
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
