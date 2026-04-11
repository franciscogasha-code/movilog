import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene1Problem } from "./scenes/Scene1Problem";
import { Scene2Solution } from "./scenes/Scene2Solution";
import { Scene3Operation } from "./scenes/Scene3Operation";
import { Scene4Impact } from "./scenes/Scene4Impact";
import { Scene5Roles } from "./scenes/Scene5Roles";
import { Scene6Closing } from "./scenes/Scene6Closing";

const TRANSITION_DURATION = 15;

// Durations matched to voiceover audio lengths (audio_seconds * 30fps + 15 frames padding)
const SCENE_DURATIONS = {
  scene1: 272,  // 8.54s audio
  scene2: 140,  // 4.13s audio
  scene3: 387,  // 12.4s audio
  scene4: 225,  // 6.97s audio
  scene5: 322,  // 10.22s audio
  scene6: 312,  // 9.89s audio
};

export const MainVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.scene1}>
          <Scene1Problem />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.scene2}>
          <Scene2Solution />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.scene3}>
          <Scene3Operation />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.scene4}>
          <Scene4Impact />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.scene5}>
          <Scene5Roles />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.scene6}>
          <Scene6Closing />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
