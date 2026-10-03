# rescue-server as a Vercel Function container (Container Images). The engine and API run here; the frontends are
# served by the "web" service (tools/vercel/static.sh) from the CDN. See vercel.json.
FROM swift:6.2-noble AS build
WORKDIR /src/rescue
COPY Package.swift ./
COPY Sources ./Sources
RUN swift build -c release --product rescue-server

FROM swift:6.2-noble-slim
WORKDIR /app
COPY --from=build /src/rescue/.build/release/rescue-server /app/rescue-server
# engine inputs only: scenarios (blind rounds excluded by .dockerignore) and the simulator run list for Walidacja
COPY scenarios /app/scenarios
COPY eval/sim/out /app/eval/sim/out
# exercise mode: hidden truth of the training exercises (read only by /api/exercise/*, never served)
COPY exercises /app/exercises
# timeline mode: DEM crops for FOV line of sight (scenarios/tracks/ and scenarios/fov/ come with scenarios above;
# .dockerignore lets only tools/terrain/data/*-dem.json through, blind rounds excluded). Without them: everything visible.
COPY tools/terrain/data /app/tools/terrain/data
ENV RESCUE_DIR=/tmp/rescue RESCUE_PUBLIC=1 RESCUE_LIVE_FILE=/tmp/live-events.json
EXPOSE 80
# the image is read-only at runtime: work on a copy in /tmp (Studio saves land in scenarios/ and in the store)
CMD ["sh", "-c", "mkdir -p /tmp/rescue && cp -R /app/scenarios /app/eval /app/exercises /app/tools /tmp/rescue/ && exec /app/rescue-server 80 --host 0.0.0.0"]
