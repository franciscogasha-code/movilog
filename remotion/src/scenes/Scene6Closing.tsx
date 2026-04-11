import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: titleFont } = loadSpaceGrotesk("normal", { weights: ["700"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadInter("normal", { weights: ["500"], subsets: ["latin"] });

export const Scene6Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // "De mensajes sueltos a un flujo ordenado"
  const line1Progress = spring({ frame: frame - 5, fps, config: { damping: 200 } });
  const line1Opacity = interpolate(line1Progress, [0, 1], [0, 1]);
  const line1Y = interpolate(line1Progress, [0, 1], [20, 0]);

  // Fade out line1 to make room for hero
  const line1FadeOut = interpolate(frame, [30, 40], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "Menos WhatsApp. Más control." — hero text
  const heroProgress = spring({ frame: frame - 35, fps, config: { damping: 15, stiffness: 100 } });
  const heroScale = interpolate(heroProgress, [0, 1], [0.85, 1]);
  const heroOpacity = interpolate(heroProgress, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });

  // "MoviLog — Logística real, en tiempo real"
  const footerProgress = spring({ frame: frame - 55, fps, config: { damping: 200 } });
  const footerOpacity = interpolate(footerProgress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: "#171D2A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Transition line */}
        <div
          style={{
            opacity: line1Opacity * line1FadeOut,
            transform: `translateY(${line1Y}px)`,
            marginBottom: 40,
          }}
        >
          <span
            style={{
              fontFamily: bodyFont,
              fontSize: 32,
              color: "rgba(255,255,255,0.6)",
              fontWeight: 500,
            }}
          >
            De mensajes sueltos a un flujo ordenado
          </span>
        </div>

        {/* Hero message */}
        <div
          style={{
            opacity: heroOpacity,
            transform: `scale(${heroScale})`,
          }}
        >
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 80,
              fontWeight: 700,
              color: "#FFFFFF",
              lineHeight: 1.2,
            }}
          >
            Menos WhatsApp.
          </span>
          <br />
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 80,
              fontWeight: 700,
              color: "#F5A623",
              lineHeight: 1.2,
            }}
          >
            Más control.
          </span>
        </div>

        {/* Footer */}
        <div
          style={{
            opacity: footerOpacity,
            marginTop: 48,
          }}
        >
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 28,
              color: "rgba(255,255,255,0.5)",
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            MoviLog — Logística real, en tiempo real
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
