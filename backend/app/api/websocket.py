from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# session_id -> list of active WebSocket connections
_connections: dict[str, list[WebSocket]] = {}


async def broadcast(session_id: str, message: dict) -> None:
    conns = _connections.get(session_id, [])
    dead: list[WebSocket] = []
    for ws in conns:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        conns.remove(ws)


@router.websocket("/ws/sessions/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    _connections.setdefault(session_id, []).append(websocket)
    try:
        while True:
            # Keep connection alive; client may send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        conns = _connections.get(session_id, [])
        if websocket in conns:
            conns.remove(websocket)
