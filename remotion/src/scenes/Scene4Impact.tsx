import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: titleFont } = loadSpaceGrotesk("normal", { weights: ["700"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadInter("normal", { weights: ["500"], subsets: ["latin"] });

const IMPACTS = [
  { text: "Menos errores en el día a día", color: "#29A380", delay: 10 },
  { text: "Más control entre sucursales", color: "#2256B3", delay: 30 },
  { text: "Información en tiempo real", color: "#F5A623", delay: 50 },
];

export const Scene4Impact: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerProgress = spring({ frame: frame - 3, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #171D2A 0%, #1C2438 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Header */}
        <div style={{ opacity: interpolate(headerProgress, [0, 1], [0, 1]), marginBottom: 80 }}>
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 40,
              fontWeight: 700,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Resultado real
          </span>
        </div>

        {/* Impact lines */}
        {IMPACTS.map((item, i) => {
          const progress = spring({
            frame: frame - item.delay,
            fps,
            config: { damping: 200 },
          });
          const opacity = interpolate(progress, [0, 1], [0, 1]);
          const x = interpolate(progress, [0, 1], [-60, 0]);

          // Accent line
          const lineWidth = interpolate(progress, [0, 1], [0, 60]);

          return (
            <div
              key={i}
              style={{
                opacity,
                transform: `translateX(${x}px)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 20,
                marginBottom: 48,
              }}
            >
              <div
                style={{
                  width: lineWidth,
                  height: 4,
                  borderRadius: 2,
                  background: item.color,
                }}
              />
              <span
                style={{
                  fontFamily: bodyFont,
                  fontSize: 48,
                  fontWeight: 500,
                  color: "#FFFFFF",
                }}
              >
                {item.text}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
