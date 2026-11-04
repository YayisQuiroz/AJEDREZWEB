/* =====================================================================
   ACTUALIZACIÓN: agrega el reloj de ajedrez y el motivo de fin de partida
   a una base "AjedrezDb" que YA existe (conserva usuarios y partidas).
   Si prefieres empezar de cero, borra la base y usa Database.sql.
   ===================================================================== */
USE AjedrezDb;   -- en un hosting, quita esta línea y ejecuta en tu base
GO

IF COL_LENGTH('Games', 'EndReason') IS NULL
    ALTER TABLE Games ADD EndReason NVARCHAR(20) NULL;
GO
IF COL_LENGTH('Games', 'TimeControlSeconds') IS NULL
    ALTER TABLE Games ADD TimeControlSeconds INT NOT NULL CONSTRAINT DF_Games_TimeControl DEFAULT 0;
GO
IF COL_LENGTH('Games', 'WhiteTimeMs') IS NULL
    ALTER TABLE Games ADD WhiteTimeMs INT NOT NULL CONSTRAINT DF_Games_WhiteTime DEFAULT 0;
GO
IF COL_LENGTH('Games', 'BlackTimeMs') IS NULL
    ALTER TABLE Games ADD BlackTimeMs INT NOT NULL CONSTRAINT DF_Games_BlackTime DEFAULT 0;
GO
IF COL_LENGTH('Games', 'LastMoveAt') IS NULL
    ALTER TABLE Games ADD LastMoveAt DATETIME2 NULL;
GO

-- Verificación
SELECT TOP 5 Code, Status, Result, EndReason, TimeControlSeconds FROM Games ORDER BY Id DESC;
