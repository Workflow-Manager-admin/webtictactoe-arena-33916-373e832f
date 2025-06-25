from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict
import uuid

app = FastAPI(
    title="Tic Tac Toe Backend",
    description="REST API for Tic Tac Toe. Handles sessions, game state, moves, player management, and basic AI.",
    version="1.0.0",
    openapi_tags=[
        {"name": "sessions", "description": "User session management"},
        {"name": "games", "description": "Game state, moves, and board"},
        {"name": "ai", "description": "AI opponent endpoints"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- In-memory session and game stores ---
sessions_store: Dict[str, str] = {}    # session_id -> player_name
games_store: Dict[str, dict] = {}      # game_id -> game dict

# --- Data models ---

class NewSessionRequest(BaseModel):
    player_name: str = Field(..., description="Name for the new user session.")

class SessionResponse(BaseModel):
    session_id: str = Field(..., description="Session ID for the player.")
    player_name: str = Field(..., description="Name of the session/player.")

class NewGameRequest(BaseModel):
    session_id: str = Field(..., description="Session ID creating the game.")
    mark: Literal["X", "O"] = Field("X", description="Mark for this player (X or O).")
    opponent_type: Literal["ai", "human"] = Field("human", description="Choose AI or human as opponent.")

class JoinGameRequest(BaseModel):
    session_id: str = Field(..., description="Session ID joining as second player.")

class MoveRequest(BaseModel):
    session_id: str = Field(..., description="Session ID making the move.")
    row: int = Field(..., ge=0, le=2, description="Row index (0-2).")
    col: int = Field(..., ge=0, le=2, description="Column index (0-2).")

class GameStateResponse(BaseModel):
    game_id: str = Field(..., description="Game ID.")
    board: List[List[Optional[str]]] = Field(..., description="3x3 board with marks: X, O, or null.")
    current_turn: Optional[str] = Field(None, description="X or O, whose turn it is next.")
    winner: Optional[str] = Field(None, description="'X', 'O', 'Draw', or null")
    state: str = Field(..., description="active|waiting|finished")
    players: Dict[str, Optional[str]] = Field(..., description="Marks as keys (X/O), values are player names or 'AI'.")

class ListGamesResponse(BaseModel):
    games: List[GameStateResponse] = Field(..., description="List of games available.")

# --- Utility/game logic functions ---

# PUBLIC_INTERFACE
def check_winner(board: List[List[Optional[str]]]) -> Optional[str]:
    """Check board for a winner or draw.
    Returns 'X', 'O', 'Draw', or None if ongoing.
    """
    lines = []
    # Rows & columns
    for i in range(3):
        lines.append(board[i])  # Row
        lines.append([board[0][i], board[1][i], board[2][i]])  # Col
    # Diagonals
    lines.append([board[0][0], board[1][1], board[2][2]])
    lines.append([board[0][2], board[1][1], board[2][0]])

    for line in lines:
        if line[0] and all(x == line[0] for x in line):
            return line[0]
    if all(cell for row in board for cell in row):
        return "Draw"
    return None

# PUBLIC_INTERFACE
def next_mark(current_mark: str) -> str:
    """Switch X <-> O."""
    return "O" if current_mark == "X" else "X"

# PUBLIC_INTERFACE
def compute_ai_move(board: List[List[Optional[str]]], mark: str) -> (int, int):
    """Basic AI - pick the first available cell."""
    for i in range(3):
        for j in range(3):
            if not board[i][j]:
                return i, j
    raise Exception("No moves left.")

# ------- REST API endpoints --------

@app.get("/", tags=["sessions"])
def health_check():
    """Health check endpoint."""
    return {"message": "Backend is healthy."}


# SESSION ENDPOINTS

@app.post("/session/new", response_model=SessionResponse, tags=["sessions"], summary="Create a new user session")
# PUBLIC_INTERFACE
def create_session(req: NewSessionRequest = Body(...)):
    """Create a new player session. Returns session ID."""
    session_id = str(uuid.uuid4())
    sessions_store[session_id] = req.player_name
    return SessionResponse(session_id=session_id, player_name=req.player_name)

@app.get("/session/{session_id}", response_model=SessionResponse, tags=["sessions"], summary="Get session info")
# PUBLIC_INTERFACE
def get_session(session_id: str):
    """Retrieve a session's info by session_id."""
    player_name = sessions_store.get(session_id)
    if not player_name:
        raise HTTPException(status_code=404, detail="Session not found.")
    return SessionResponse(session_id=session_id, player_name=player_name)


# GAME ENDPOINTS

@app.post("/games/new", response_model=GameStateResponse, tags=["games"], summary="Create a new game")
# PUBLIC_INTERFACE
def create_game(req: NewGameRequest = Body(...)):
    """Create a new game (vs human or AI). Caller is first player."""
    if req.session_id not in sessions_store:
        raise HTTPException(status_code=404, detail="Invalid session.")
    game_id = str(uuid.uuid4())
    board = [[None for _ in range(3)] for _ in range(3)]
    player_mark = req.mark
    other_mark = next_mark(player_mark)
    players = {player_mark: sessions_store[req.session_id], other_mark: None}
    if req.opponent_type == "ai":
        players[other_mark] = "AI"

    game = {
        "game_id": game_id,
        "board": board,
        "current_turn": "X",
        "winner": None,
        "state": "waiting" if req.opponent_type == "human" else "active",
        "players": players,
        "opponent_type": req.opponent_type,
        "marks": {sessions_store[req.session_id]: player_mark}
    }
    games_store[game_id] = game
    return GameStateResponse(**game)

@app.post("/games/{game_id}/join", response_model=GameStateResponse, tags=["games"], summary="Join an existing game")
# PUBLIC_INTERFACE
def join_game(game_id: str, req: JoinGameRequest = Body(...)):
    """Join a waiting game as the second player (for human vs human)."""
    game = games_store.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["state"] != "waiting" or game["opponent_type"] != "human":
        raise HTTPException(status_code=400, detail="Cannot join this game.")
    if req.session_id not in sessions_store:
        raise HTTPException(status_code=404, detail="Invalid session.")
    # Assign mark to joining player (whichever mark is None)
    assigned_mark = [m for m, p in game["players"].items() if p is None][0]
    game["players"][assigned_mark] = sessions_store[req.session_id]
    game["state"] = "active"
    game["marks"][sessions_store[req.session_id]] = assigned_mark
    return GameStateResponse(**game)

@app.get("/games/{game_id}", response_model=GameStateResponse, tags=["games"], summary="Get game state")
# PUBLIC_INTERFACE
def get_game(game_id: str):
    """Fetch current state of the game."""
    game = games_store.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    return GameStateResponse(**game)

@app.get("/games", response_model=ListGamesResponse, tags=["games"], summary="List games")
# PUBLIC_INTERFACE
def list_games(only_waiting: Optional[bool] = False):
    """List all games (optionally only waiting for second player)."""
    games_list = []
    for game in games_store.values():
        if only_waiting and game["state"] != "waiting":
            continue
        games_list.append(GameStateResponse(**game))
    return ListGamesResponse(games=games_list)


@app.post("/games/{game_id}/move", response_model=GameStateResponse, tags=["games"], summary="Make a move")
# PUBLIC_INTERFACE
def make_move(game_id: str, req: MoveRequest = Body(...)):
    """Make a move in the specified game. Advances turn, updates winner/state."""
    game = games_store.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["winner"]:
        raise HTTPException(status_code=400, detail="Game is over.")
    if req.session_id not in sessions_store:
        raise HTTPException(status_code=403, detail="Invalid session.")

    player_name = sessions_store[req.session_id]
    player_mark = None
    for mark, name in game["players"].items():
        if name == player_name:
            player_mark = mark
    if not player_mark:
        raise HTTPException(status_code=403, detail="Not a player of this game.")
    if game["current_turn"] != player_mark:
        raise HTTPException(status_code=400, detail="Not your turn.")

    board = game["board"]
    if board[req.row][req.col]:
        raise HTTPException(status_code=400, detail="Cell occupied.")

    board[req.row][req.col] = player_mark
    winner = check_winner(board)
    game["winner"] = winner
    if winner:
        game["state"] = "finished"
        game["current_turn"] = None
    else:
        game["current_turn"] = next_mark(player_mark)
        # If AI next, make AI move automatically
        if (
            game["opponent_type"] == "ai"
            and game["players"][game["current_turn"]] == "AI"
        ):
            ai_row, ai_col = compute_ai_move(board, game["current_turn"])
            board[ai_row][ai_col] = game["current_turn"]
            winner = check_winner(board)
            game["winner"] = winner
            if winner:
                game["state"] = "finished"
                game["current_turn"] = None
            else:
                game["current_turn"] = next_mark(game["current_turn"])
    return GameStateResponse(**game)


@app.post("/games/{game_id}/restart", response_model=GameStateResponse, tags=["games"], summary="Restart a finished game")
# PUBLIC_INTERFACE
def restart_game(game_id: str, req: MoveRequest = Body(...)):
    """Restart an existing finished game with the same players and marks."""
    game = games_store.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["state"] != "finished":
        raise HTTPException(status_code=400, detail="Game not finished")

    # Confirm caller is a participant
    player_name = sessions_store.get(req.session_id)
    if not player_name or player_name not in game["marks"]:
        raise HTTPException(status_code=403, detail="Not a player of this game.")

    new_board = [[None for _ in range(3)] for _ in range(3)]
    game["board"] = new_board
    game["current_turn"] = "X"
    game["winner"] = None
    game["state"] = "active" if None not in game["players"].values() else "waiting"
    return GameStateResponse(**game)


# AI Demo endpoint
@app.post("/ai/play", response_model=GameStateResponse, tags=["ai"], summary="Let AI make a move on your behalf")
# PUBLIC_INTERFACE
def ai_play(game_id: str, mark: str = Body(..., embed=True)):
    """
    Lets the AI play a move for the given mark, for demo/testing.
    """
    game = games_store.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["winner"]:
        raise HTTPException(status_code=400, detail="Game is over.")
    if mark not in ["X", "O"]:
        raise HTTPException(status_code=400, detail="Invalid mark.")
    if game["current_turn"] != mark:
        raise HTTPException(status_code=400, detail="Not this mark's turn.")
    board = game["board"]
    row, col = compute_ai_move(board, mark)
    board[row][col] = mark
    winner = check_winner(board)
    game["winner"] = winner
    if winner:
        game["state"] = "finished"
        game["current_turn"] = None
    else:
        game["current_turn"] = next_mark(mark)
    return GameStateResponse(**game)
