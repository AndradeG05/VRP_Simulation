import { useTravelTime, type TravelClock } from "./simulation";
export default function PlaybackPosition({
  clock,
  maximum,
  pause,
  seek,
}: {
  clock: TravelClock;
  maximum: number;
  pause: () => void;
  seek: (value: number) => void;
}) {
  const travelled = useTravelTime(clock);
  return (
    <input
      aria-label="Posição da reprodução"
      type="range"
      min={0}
      max={maximum || 1}
      value={travelled}
      onChange={(e) => {
        pause();
        seek(Number(e.target.value));
      }}
    />
  );
}
