import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });

const BUBBLES = [
  { text: "Necesito 20 cajas del modelo azul", from: "left", delay: 0, y: 180 },
  { text: "Cuál modelo? El nuevo o el viejo?", from: "right", delay: 12, y: 280 },
  { text: "El que mandaron la semana pasada", from: "left", delay: 22, y: 380 },
  { text: "No me llegó nada la semana pasada", from: "right", delay: 32, y: 480 },
  { text: "Preguntale a José que él sabe", from: "left", delay: 42, y: 570 },
  { text: "José está de viaje hasta el jueves", from: "right", delay: 52, y: 660 },
];

const PAIN_TEXTS = [
  { text: "Se pierden mensajes", delay: 65, y: 300 },
  { text: "Pedidos sin seguimiento", delay: 80, y: 440 },
  { text: "Nadie sabe en qué quedó", delay: 95, y: 580 },
];

const ChatBubble: React.FC<{
  text: string;
  from: "left" | "right";
  delay: number;
  y: number;
}> = ({ text, from, delay, y }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
  });

  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [20, 0]);

  // Fade out when pain texts appear
  const fadeOut = interpolate(frame, [60, 75], [1, 0.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const isLeft = from === "left";

  return (
    <div
      style={{
        position: "absolute",
        top: y,
        left: isLeft ? 460 : undefined,
        right: isLeft ? undefined : 460,
        opacity: opacity * fadeOut,
        transform: `translateY(${translateY}px)`,
        maxWidth: 500,
        fontFamily,
      }}
    >
      <div
        style={{
          background: isLeft ? "#DCF8C6" : "#FFFFFF",
          borderRadius: 12,
          padding: "12px 18px",
          fontSize: 22,
          color: "#1A1A1A",
          fontWeight: 400,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const Scene1Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title at top
  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #1A1F2E 0%, #171D2A 100%)",
        fontFamily,
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 60,
          width: "100%",
          textAlign: "center",
          opacity: titleOpacity,
        }}
      >
        <span
          style={{
            fontSize: 28,
            color: "#F5A623",
            fontWeight: 600,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          Pedidos por WhatsApp...
        </span>
      </div>

      {/* Chat bubbles */}
      {BUBBLES.map((b, i) => (
        <ChatBubble key={i} {...b} />
      ))}

      {/* Pain text overlays */}
      {PAIN_TEXTS.map((p, i) => {
        const progress = spring({
          frame: frame - p.delay,
          fps,
          config: { damping: 200 },
        });
        const opacity = interpolate(progress, [0, 1], [0, 1]);
        const scale = interpolate(progress, [0, 1], [0.9, 1]);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: p.y,
              width: "100%",
              textAlign: "center",
              opacity,
              transform: `scale(${scale})`,
            }}
          >
            <span
              style={{
                fontSize: 48,
                fontWeight: 600,
                color: "#FFFFFF",
                textShadow: "0 2px 20px rgba(0,0,0,0.8)",
                background: "rgba(220, 53, 69, 0.85)",
                padding: "8px 32px",
                borderRadius: 8,
              }}
            >
              {p.text}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
