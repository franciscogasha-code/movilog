import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: titleFont } = loadSpaceGrotesk("normal", { weights: ["600", "700"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadInter("normal", { weights: ["400", "500"], subsets: ["latin"] });

const CARDS = [
  { icon: "📋", text: "Cargás el pedido una sola vez", delay: 10 },
  { icon: "📦", text: "Ves el stock real por sucursal", delay: 30 },
  { icon: "🚚", text: "El envío ya queda listo", delay: 50 },
  { icon: "✅", text: "Todo queda registrado en el sistema", delay: 70 },
];

export const Scene3Operation: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerProgress = spring({ frame: frame - 5, fps, config: { damping: 200 } });
  const headerOpacity = interpolate(headerProgress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #171D2A 0%, #1A2235 100%)",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 80,
          width: "100%",
          textAlign: "center",
          opacity: headerOpacity,
        }}
      >
        <span
          style={{
            fontFamily: titleFont,
            fontSize: 44,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Así funciona en{" "}
          <span style={{ color: "#F5A623" }}>MoviLog</span>
        </span>
      </div>

      {/* Cards - 2x2 grid */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 0,
          right: 0,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 40,
          padding: "0 200px",
        }}
      >
        {CARDS.map((card, i) => {
          const progress = spring({
            frame: frame - card.delay,
            fps,
            config: { damping: 20, stiffness: 180 },
          });
          const opacity = interpolate(progress, [0, 1], [0, 1]);
          const translateY = interpolate(progress, [0, 1], [40, 0]);

          return (
            <div
              key={i}
              style={{
                width: 680,
                opacity,
                transform: `translateY(${translateY}px)`,
              }}
            >
              <div
                style={{
                  background: "rgba(34, 86, 179, 0.12)",
                  border: "1px solid rgba(34, 86, 179, 0.25)",
                  borderRadius: 16,
                  padding: "32px 40px",
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                }}
              >
                <span style={{ fontSize: 48 }}>{card.icon}</span>
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: 32,
                    color: "#FFFFFF",
                    fontWeight: 500,
                    lineHeight: 1.3,
                  }}
                >
                  {card.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
