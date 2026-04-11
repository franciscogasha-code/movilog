import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: titleFont } = loadSpaceGrotesk("normal", { weights: ["600", "700"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadInter("normal", { weights: ["400", "500"], subsets: ["latin"] });

const ROLES = [
  { icon: "🏭", label: "Depósito", delay: 5 },
  { icon: "🚛", label: "Chofer", delay: 15 },
  { icon: "🖥️", label: "Administración", delay: 25 },
];

export const Scene5Roles: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerProgress = spring({ frame: frame - 2, fps, config: { damping: 200 } });
  const lineProgress = interpolate(frame, [20, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const footerProgress = spring({ frame: frame - 40, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #171D2A 0%, #1A2235 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Header */}
        <div
          style={{
            opacity: interpolate(headerProgress, [0, 1], [0, 1]),
            marginBottom: 60,
          }}
        >
          <span
            style={{
              fontFamily: titleFont,
              fontSize: 40,
              fontWeight: 700,
              color: "#FFFFFF",
            }}
          >
            Cada uno sabe qué tiene que hacer
          </span>
        </div>

        {/* Role icons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 80,
            position: "relative",
          }}
        >
          {ROLES.map((role, i) => {
            const progress = spring({
              frame: frame - role.delay,
              fps,
              config: { damping: 20, stiffness: 160 },
            });
            const scale = interpolate(progress, [0, 1], [0.5, 1]);
            const opacity = interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });

            return (
              <div
                key={i}
                style={{
                  opacity,
                  transform: `scale(${scale})`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 24,
                    background: "rgba(34, 86, 179, 0.15)",
                    border: "1px solid rgba(34, 86, 179, 0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 56,
                  }}
                >
                  {role.icon}
                </div>
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: 24,
                    color: "rgba(255,255,255,0.85)",
                    fontWeight: 500,
                  }}
                >
                  {role.label}
                </span>
              </div>
            );
          })}

          {/* Connecting line */}
          <div
            style={{
              position: "absolute",
              top: 60,
              left: "50%",
              transform: "translateX(-50%)",
              width: interpolate(lineProgress, [0, 1], [0, 520]),
              height: 2,
              background: "linear-gradient(90deg, #2256B3, #F5A623, #29A380)",
              zIndex: -1,
            }}
          />
        </div>

        {/* Footer text */}
        <div
          style={{
            opacity: interpolate(footerProgress, [0, 1], [0, 1]),
            marginTop: 60,
          }}
        >
          <span
            style={{
              fontFamily: bodyFont,
              fontSize: 28,
              color: "rgba(255,255,255,0.6)",
              fontWeight: 400,
            }}
          >
            Menos llamadas. Menos confusión.
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
