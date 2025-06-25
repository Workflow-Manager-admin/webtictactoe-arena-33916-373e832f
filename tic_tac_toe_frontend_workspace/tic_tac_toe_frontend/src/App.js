import React, { useState, useEffect } from "react";
import "./App.css";

// --- Configuration: backend API base URL ---
const BACKEND_URL =
  process.env.REACT_APP_TTT_BACKEND_URL || "http://localhost:3001"; // Make sure this matches backend

// --- Util ----
const emptyBoard = () => [
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

const MARKS = ["X", "O"];

// PUBLIC_INTERFACE
function App() {
  // Session and user/game state
  const [theme, setTheme] = useState("light");

  const [sessionName, setSessionName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [selectMark, setSelectMark] = useState("X");
  const [opponentType, setOpponentType] = useState("ai");
  const [joinGameMode, setJoinGameMode] = useState(false);

  const [gameId, setGameId] = useState(""); // current game
  const [gameState, setGameState] = useState(null); // board, current_turn, etc

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gamesWaiting, setGamesWaiting] = useState([]);

  // --- Theme toggler ---
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  // PUBLIC_INTERFACE
  const toggleTheme = () =>
    setTheme((prev) => (prev === "light" ? "dark" : "light"));

  // --- Side effect: on initial load, fetch waiting games if join game mode ---
  useEffect(() => {
    if (joinGameMode) {
      fetchListGames();
    }
    // eslint-disable-next-line
  }, [joinGameMode]);

  // FUNCTION: Create a new session
  async function createSession() {
    setError("");
    if (!sessionName.trim()) {
      setError("Please enter your name.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/session/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_name: sessionName.trim() }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).detail || "Session error");
      }
      const data = await res.json();
      setSessionId(data.session_id);
    } catch (e) {
      setError("Failed to create session: " + e.message);
    }
    setLoading(false);
  }

  // FUNCTION: Start a new game
  async function createGame() {
    setError("");
    setGameId("");
    setGameState(null);
    setLoading(true);
    try {
      const payload = {
        session_id: sessionId,
        mark: selectMark,
        opponent_type: opponentType,
      };
      const res = await fetch(`${BACKEND_URL}/games/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error((await res.json()).detail || "Failed to create game");
      }
      const game = await res.json();
      setGameState(game);
      setGameId(game.game_id);
    } catch (e) {
      setError("Failed to create game: " + e.message);
    }
    setLoading(false);
  }

  // FUNCTION: List waiting games
  async function fetchListGames() {
    setError("");
    try {
      const res = await fetch(`${BACKEND_URL}/games?only_waiting=true`);
      const data = await res.json();
      setGamesWaiting(data.games || []);
    } catch {
      setGamesWaiting([]);
    }
  }

  // FUNCTION: Join existing (waiting) game (human-vs-human)
  async function joinGame(gid) {
    setError("");
    setLoading(true);
    try {
      if (!sessionId) throw new Error("Session not found");
      const res = await fetch(`${BACKEND_URL}/games/${gid}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).detail || "Cannot join game");
      }
      const game = await res.json();
      setGameState(game);
      setGameId(game.game_id);
      setJoinGameMode(false);
    } catch (e) {
      setError("Failed to join: " + e.message);
    }
    setLoading(false);
  }

  // FUNCTION: Make a move
  async function makeMove(row, col) {
    if (
      !gameState ||
      !sessionId ||
      gameState.board[row][col] ||
      gameState.winner ||
      loading
    )
      return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/games/${gameId}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, row, col }),
        }
      );
      if (!res.ok) {
        throw new Error((await res.json()).detail || "Move failed");
      }
      const game = await res.json();
      setGameState(game);
    } catch (e) {
      setError("Failed to move: " + e.message);
    }
    setLoading(false);
  }

  // FUNCTION: Restart game
  async function restartGame() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/games/${gameId}/restart`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, row: 0, col: 0 }), // row/col not used
        }
      );
      if (!res.ok) {
        throw new Error((await res.json()).detail || "Restart failed");
      }
      const game = await res.json();
      setGameState(game);
    } catch (e) {
      setError("Failed to restart: " + e.message);
    }
    setLoading(false);
  }

  // FUNCTION: Poll for game state in human-vs-human as the second after joining (waiting for second player)
  useEffect(() => {
    let iv = null;
    if (gameState && gameState.state === "waiting") {
      iv = setInterval(async () => {
        try {
          const res = await fetch(
            `${BACKEND_URL}/games/${gameId}`
          );
          if (res.ok) {
            const game = await res.json();
            setGameState(game);
          }
        } catch { }
      }, 2500);
    }
    return () => { if (iv) clearInterval(iv); };
    // eslint-disable-next-line
  }, [gameState && gameState.state]);

  // FUNCTION: Poll for moves in PvP if it's not user's turn
  useEffect(() => {
    let iv = null;
    if (
      gameState &&
      gameState.state === "active" &&
      gameState.current_turn &&
      sessionId
    ) {
      const userMark =
        Object.entries(gameState.players).find(
          ([, v]) => v === sessionName
        )?.[0];
      if (userMark && gameState.current_turn !== userMark) {
        iv = setInterval(async () => {
          try {
            const res = await fetch(`${BACKEND_URL}/games/${gameId}`);
            if (res.ok) {
              const game = await res.json();
              setGameState(game);
            }
          } catch { }
        }, 1800);
      }
    }
    return () => { if (iv) clearInterval(iv); };
    // eslint-disable-next-line
  }, [gameState && gameState.current_turn, gameState && gameState.state]);

  // --- RENDER functions ---
  function renderSessionForm() {
    return (
      <div className="session-form" style={panelStyle()}>
        <h2>Start Playing Tic Tac Toe</h2>
        <input
          className="input"
          type="text"
          maxLength={16}
          placeholder="Enter your name..."
          value={sessionName}
          disabled={loading}
          onChange={(e) => setSessionName(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <br />
        <button className="btn" onClick={createSession} disabled={!sessionName.trim() || loading}>
          {loading ? "Creating..." : "Begin"}
        </button>
      </div>
    );
  }

  function renderGameSetup() {
    return (
      <div style={panelStyle()}>
        <h2>Choose Game Options</h2>
        <div style={{ margin: "12px 0" }}>
          <label>
            <span style={labelStyle()}>Mark:</span>
            <select
              className="input"
              value={selectMark}
              onChange={(e) => setSelectMark(e.target.value)}
              style={{ marginLeft: 10, fontWeight: 600 }}
            >
              <option value="X">X</option>
              <option value="O">O</option>
            </select>
          </label>
        </div>
        <div style={{ margin: "10px 0" }}>
          <label>
            <span style={labelStyle()}>Opponent:</span>
            <select
              className="input"
              value={opponentType}
              onChange={(e) => setOpponentType(e.target.value)}
              style={{ marginLeft: 10, fontWeight: 600 }}
            >
              <option value="ai">AI (computer)</option>
              <option value="human">Human (online)</option>
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 18 }}>
          <button className="btn btn-primary" onClick={createGame} disabled={loading}>
            {loading ? "Starting..." : "Start Game"}
          </button>
          <button
            className="btn btn-secondary"
            style={{ backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
            onClick={() => setJoinGameMode(true)}
            disabled={loading}
          >
            Join Existing
          </button>
        </div>
        <div style={{ marginTop: "16px", fontSize: "0.98em", color: "var(--text-primary)" }}>
          You: <b>{sessionName}</b>
        </div>
      </div>
    );
  }

  function renderJoinGamePanel() {
    return (
      <div style={panelStyle()}>
        <h2>Join Waiting Game</h2>
        <div style={{ minHeight: 48 }}>
          {gamesWaiting.length === 0 && <span style={{ color: "#888" }}>No waiting games.</span>}
          <ul style={{ padding: 0, listStyle: "none" }}>
            {gamesWaiting.map((g) => (
              <li key={g.game_id} style={{ marginBottom: "8px" }}>
                <span>
                  <b>{g.players["X"] || "?"}</b> (X) vs ? ({g.state})
                </span>
                <button
                  className="btn btn-small"
                  style={{ marginLeft: 14 }}
                  onClick={() => joinGame(g.game_id)}
                  disabled={loading}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => setJoinGameMode(false)}>
          Back
        </button>
      </div>
    );
  }

  function renderGameBoard() {
    if (!gameState) return null;
    const { board, current_turn, winner, state, players } = gameState;

    const userMark =
      Object.entries(players).find(([, name]) => name === sessionName)?.[0];
    const opponent =
      Object.entries(players).find(
        ([mark, name]) => name && name !== sessionName
      ) || [];
    const isYourTurn = !winner && current_turn === userMark;
    const boardIsClickable = isYourTurn;

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {players["X"] && players["O"]
            ? `${players["X"] || "?"} (X) vs ${players["O"] || "?"} (O)`
            : "Waiting for opponent..."}
        </h3>
        <div
          className="ttt-board"
          style={{
            display: "grid",
            gridTemplateRows: "repeat(3, 70px)",
            gridTemplateColumns: "repeat(3, 70px)",
            gap: 0,
            margin: "16px 0",
            boxShadow: "0 2px 16px rgba(0,0,0,.11)",
            borderRadius: "18px",
            background: "var(--bg-secondary)",
            border: "2.5px solid var(--border-color)",
            userSelect: "none",
            position: "relative",
            aspectRatio: "1/1",
            maxWidth: 240,
            minWidth: 200,
          }}
        >
          {board.map((row, i) =>
            row.map((cell, j) => (
              <div
                key={i * 3 + j}
                className="cell"
                tabIndex={0}
                aria-label={`row ${i + 1} col ${j + 1}`}
                onClick={() => boardIsClickable && !cell && makeMove(i, j)}
                style={{
                  background: "var(--bg-primary)",
                  border:
                    i < 2
                      ? j < 2
                        ? "1.2px solid var(--border-color)"
                        : "1.5px solid var(--border-color)"
                      : "none",
                  borderBottom: i < 2 ? "2.5px solid var(--border-color)" : "none",
                  borderRight: j < 2 ? "2.5px solid var(--border-color)" : "none",
                  borderRadius:
                    (i === 0 && j === 0) ? "16px 0 0 0" :
                      (i === 0 && j === 2) ? "0 16px 0 0" :
                        (i === 2 && j === 0) ? "0 0 0 16px" :
                          (i === 2 && j === 2) ? "0 0 16px 0" :
                            "0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.3em",
                  fontWeight: 600,
                  color:
                    cell === "X"
                      ? "var(--text-primary)"
                      : cell === "O"
                        ? "var(--text-secondary)"
                        : "#bbb",
                  cursor: boardIsClickable && !cell ? "pointer" : "default",
                  transition: "background 0.2s",
                  outline: "none",
                  minWidth: 55,
                  minHeight: 55,
                }}
              >
                {cell}
              </div>
            ))
          )}
        </div>
        <div style={{
          fontWeight: 500,
          padding: "5px 16px",
          margin: "0 0 12px 0",
          borderRadius: "9px",
          background: "var(--bg-primary)",
          fontSize: "1.01em",
        }}>
          {winner
            ? (
              winner === "Draw"
                ? "Draw! 🤝"
                : (players[winner]
                    ? (players[winner] === sessionName ? "You win! 🏆" : `${players[winner]} wins!`)
                    : `${winner} wins!`)
            )
            : (state === "waiting"
                ? "Waiting for second player to join..."
                : (isYourTurn ? "Your turn" : "Opponent's turn"))}
        </div>
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          <button className="btn btn-secondary" onClick={() => {
            setGameId("");
            setGameState(null);
            setError("");
          }}>
            {winner || state === "waiting" ? "Back" : "Forfeit"}
          </button>
          {(winner || state === "finished") && (
            <button className="btn btn-primary" onClick={restartGame} disabled={loading}>
              {loading ? "Restarting..." : "Restart Game"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- Styling ---
  function panelStyle() {
    return {
      background: "var(--bg-secondary)",
      borderRadius: "12px",
      boxShadow: "0 2.5px 14px rgba(0,0,0,.08)",
      padding: "32px 28px",
      color: "var(--text-primary)",
      margin: "18px 0",
      minWidth: 260,
      maxWidth: 330,
      display: "flex",
      flexDirection: "column",
      alignItems: "center"
    };
  }
  function labelStyle() {
    return {
      fontWeight: 500,
      fontSize: "1.04em"
    };
  }

  // --- Main render ---
  return (
    <div className="App" style={{
      minHeight: "100vh",
      background: "var(--bg-primary)",
      color: "var(--text-primary)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
      padding: 0,
    }}>
      <header className="App-header" style={{
        background: "var(--bg-secondary)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}>
        <button
          className="theme-toggle"
          style={{
            position: "absolute",
            top: 22,
            right: 24,
            zIndex: 2,
          }}
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? "🌙 Dark" : "☀️ Light"}
        </button>

        <h1 style={{
          fontSize: "2.1em",
          fontWeight: 600,
          marginBottom: 6,
          color: "var(--text-primary)",
        }}>
          Tic Tac Toe <span style={{ color: "#1976d2" }}>Arena</span>
        </h1>
        <div style={{ color: "#444", marginBottom: 15, fontSize: "1.1em" }}>
          Minimal, Modern, Multiplayer <span role="img" aria-label="spark">⚡</span>
        </div>

        <main>
          {error && (
            <div style={{
              color: "#ff4343",
              fontWeight: 500,
              marginBottom: 8,
              padding: "7px 18px",
              background: "rgba(220,20,60,0.09)",
              borderRadius: "7px",
            }}>
              {error}
            </div>
          )}

          {!sessionId && renderSessionForm()}
          {sessionId && !gameState && !joinGameMode && renderGameSetup()}
          {sessionId && !gameState && joinGameMode && renderJoinGamePanel()}
          {gameState && renderGameBoard()}
        </main>

        <footer style={{
          color: "#888",
          fontSize: "0.95em",
          marginTop: 34,
          marginBottom: 6,
          position: "absolute",
          bottom: 10,
        }}>
          <span>
            <a
              className="App-link"
              href="https://github.com/kavia-ai"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none", color: "var(--text-secondary)" }}
            >
              Kavia.ai
            </a>{" "}
            | modern Tic Tac Toe 🕹️
          </span>
        </footer>
      </header>
    </div>
  );
}

export default App;
