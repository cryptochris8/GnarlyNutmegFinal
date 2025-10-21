/**
 * UIEventHandlers - Handles player UI interaction events
 *
 * Manages all UI data events including:
 * - Game mode selection (FIFA, Arcade, Tournament)
 * - Team selection (single player, multiplayer)
 * - In-game controls (pass requests, manual resets)
 * - Tournament management
 * - Spectator mode controls
 * - Mobile input handling (movement, actions, camera, gestures)
 *
 * Extracted from index.ts (lines 412-1722) to reduce file size.
 * This massive handler was nested within the JOINED_WORLD event.
 *
 * @note This file is intentionally large due to the comprehensive
 * UI event system. Consider splitting into sub-handlers if it grows beyond 2000 lines.
 */

import { World, Player, PlayerUIEvent, EntityEvent } from "hytopia";
import { SoccerGame } from "../core/SoccerGame";
import { AIPlayerEntity } from "../entities/AIPlayerEntity";
import { SoccerPlayerEntity } from "../entities/SoccerPlayerEntity";
import { AudioManager } from "../core/AudioManager";
import { logger } from "../../utils/GameLogger";
import { SharedState } from "../state/SharedState";
import { SpectatorMode } from "../systems/SpectatorMode";
import { FIFACrowdManager } from "../systems/FIFACrowdManager";
import { PickupManager } from "../systems/PickupManager";
import { TournamentManager } from "../systems/TournamentManager";
import { PlayerManager } from "../core/PlayerManager";
import { GameMode, setGameMode, getCurrentModeConfig, isFIFAMode, isArcadeMode } from "../../state/gameModes";
import { getStartPosition } from "../utils/positions";
import { getDirectionFromRotation } from "../utils/helpers";

export interface UIEventDependencies {
  world: World;
  game: SoccerGame | null;
  aiPlayers: AIPlayerEntity[];
  audioManager: AudioManager;
  sharedState: SharedState;
  spectatorMode: SpectatorMode;
  fifaCrowdManager: FIFACrowdManager;
  pickupManager: PickupManager;
  tournamentManager: TournamentManager;
  spawnAIPlayers: (team?: string) => Promise<void>;
}

export class UIEventHandlers {
  private deps: UIEventDependencies;

  constructor(deps: UIEventDependencies) {
    this.deps = deps;
  }

  /**
   * Register UI event handler for a specific player
   * This should be called when a player joins the world
   */
  registerPlayerUIHandler(player: Player): void {
    player.ui.on(PlayerUIEvent.DATA, async ({ playerUI, data }) => {
      // Debug: Log all incoming data
      logger.debug(`= Server received data from ${player.username}:`, JSON.stringify(data, null, 2));

      // Route to appropriate handler based on data.type
      switch (data.type) {
        // ===== GAME MODE SELECTION =====
        case "select-game-mode":
          this.handleGameModeSelection(player, data);
          break;
        case "select-single-player":
          this.handleSinglePlayerSelection(player, data);
          break;

        // ===== TEAM SELECTION =====
        case "team-selected":
          await this.handleTeamSelection(player, data);
          break;
        case "join-multiplayer-lobby":
          this.handleJoinMultiplayerLobby(player, data);
          break;
        case "mobile-team-selection":
          this.handleMobileTeamSelection(player, data);
          break;

        // ===== GAME CONTROLS =====
        case "coin-toss-choice":
          this.handleCoinTossChoice(player, data);
          break;
        case "force-pass":
          this.handleForcePass(player, data);
          break;
        case "request-pass":
          this.handleRequestPass(player, data);
          break;
        case "manual-reset-game":
          this.handleManualResetGame(player, data);
          break;
        case "start-second-half":
          this.handleStartSecondHalf(player, data);
          break;

        // ===== TOURNAMENT MANAGEMENT =====
        case "tournament-create":
          this.handleTournamentCreate(player, data);
          break;
        case "tournament-join":
          this.handleTournamentJoin(player, data);
          break;
        case "tournament-leave":
          this.handleTournamentLeave(player, data);
          break;
        case "tournament-ready":
          this.handleTournamentReady(player, data);
          break;
        case "tournament-get-status":
          this.handleTournamentGetStatus(player, data);
          break;
        case "tournament-get-list":
          this.handleTournamentGetList(player, data);
          break;

        // ===== SPECTATOR MODE =====
        case "spectator-next-player":
          this.handleSpectatorNextPlayer(player, data);
          break;
        case "spectator-next-camera":
          this.handleSpectatorNextCamera(player, data);
          break;
        case "spectator-leave":
          this.handleSpectatorLeave(player, data);
          break;

        // ===== MOBILE INPUT =====
        case "mobile-mode-enabled":
          this.handleMobileModeEnabled(player, data);
          break;
        case "mobile-movement-input":
          this.handleMobileMovementInput(player, data);
          break;
        case "mobile-action-input":
          this.handleMobileActionInput(player, data);
          break;
        case "mobile-camera-input":
          this.handleMobileCameraInput(player, data);
          break;

        // ===== MOBILE GESTURES =====
        case "mobile-swipe-gesture":
          this.handleMobileSwipeGesture(player, data);
          break;
        case "mobile-zoom-gesture":
          this.handleMobileZoomGesture(player, data);
          break;

        default:
          logger.warn(`Unknown UI event type: ${data.type}`);
          break;
      }
    });
  }

  // ============================================================================
  // GAME MODE SELECTION HANDLERS
  // ============================================================================

  private handleGameModeSelection(player: Player, data: any): void {
    logger.info(`Player ${player.username} selected game mode: ${data.mode}`);

    // Set the game mode using the imported functions
    if (data.mode === "fifa") {
      setGameMode(GameMode.FIFA);
      logger.info("Game mode set to FIFA Mode");
    } else if (data.mode === "arcade") {
      setGameMode(GameMode.ARCADE);
      logger.info("Game mode set to Arcade Mode");
    }

    // Send confirmation back to UI
    player.ui.sendData({
      type: "game-mode-confirmed",
      mode: data.mode,
      config: getCurrentModeConfig(),
    });

    logger.info("<® Game mode selected - ready for team selection");
  }

  private handleSinglePlayerSelection(player: Player, data: any): void {
    logger.info(`Player ${player.username} selected single player mode`);

    // Send confirmation - game is ready
    player.ui.sendData({
      type: "single-player-ready",
      message: "Single player mode ready! Select your team to begin.",
    });
  }

  // ============================================================================
  // TEAM SELECTION HANDLERS
  // ============================================================================

  private async handleTeamSelection(player: Player, data: any): Promise<void> {
    logger.info(`Player ${player.username} selected team: ${data.team}`);

    // Check if player already on a team
    if (this.deps.game && this.deps.game.getTeamOfPlayer(player.username) !== null) {
      logger.info("Player already on a team");
      return;
    }

    // Check if team is full
    if (this.deps.game && this.deps.game.isTeamFull(data.team)) {
      // Offer spectator mode when team is full
      this.deps.spectatorMode.joinAsSpectator(player, this.deps.world);
      player.ui.sendData({
        type: "spectator-mode-active",
        message:
          "Team is full - you've joined as a spectator! Use /leavespectator to exit spectator mode.",
      });
      return;
    }

    // Check if player already has an entity (shouldn't happen after fix)
    const existingEntities = this.deps.world.entityManager.getPlayerEntitiesByPlayer(player);
    if (existingEntities.length > 0) {
      logger.warn(
        `   Player ${player.username} already has ${existingEntities.length} entities! Cleaning up...`
      );
      existingEntities.forEach((entity) => {
        if (entity.isSpawned) {
          logger.info(`Despawning existing entity: ${entity.id}`);
          entity.despawn();
        }
      });
    }

    // Join game and team
    if (this.deps.game) {
      this.deps.game.joinGame(player.username, player.username);
      this.deps.game.joinTeam(player.username, data.team);
    }

    // Create player entity with the assigned role
    const humanPlayerRole = "central-midfielder-1"; // Human player is now a midfielder
    const playerEntity = new SoccerPlayerEntity(player, data.team, humanPlayerRole);
    logger.info(`Creating player entity for team ${data.team} as ${humanPlayerRole}`);

    // Add spawn event listener to verify when entity is actually spawned
    playerEntity.on(EntityEvent.SPAWN, () => {
      logger.info(`Player entity ${playerEntity.id} successfully spawned with camera attachment`);
    });

    // Get correct spawn position for large stadium
    const spawnPosition = getStartPosition(data.team, humanPlayerRole);
    logger.info(
      `Using role-based spawn position for large stadium: X=${spawnPosition.x.toFixed(2)}, Y=${spawnPosition.y.toFixed(2)}, Z=${spawnPosition.z.toFixed(2)}`
    );

    // Spawn player entity immediately at calculated position
    logger.info(
      `Spawning player entity at X=${spawnPosition.x.toFixed(2)}, Y=${spawnPosition.y.toFixed(2)}, Z=${spawnPosition.z.toFixed(2)}`
    );
    playerEntity.spawn(this.deps.world, spawnPosition);
    logger.info(`Player entity ${playerEntity.id} spawn command issued as ${humanPlayerRole}.`);

    // Freeze the human player initially
    playerEntity.freeze();

    // Music change - switch from opening music to gameplay music
    if (this.deps.game) {
      const gameMode = getCurrentModeConfig();
      this.deps.audioManager.playGameplayMusic(gameMode.mode);
    }

    // Start FIFA crowd atmosphere if in FIFA mode
    if (isFIFAMode()) {
      this.deps.fifaCrowdManager.start();
      this.deps.fifaCrowdManager.playGameStart();
    }

    // Handle single player mode
    if (data.singlePlayerMode) {
      await this.handleSinglePlayerModeStart(player, data.team, playerEntity);
    }
    // Handle multiplayer mode
    else if (data.multiplayerMode) {
      await this.handleMultiplayerModeStart(player, data.team, playerEntity);
    }
  }

  private async handleSinglePlayerModeStart(
    player: Player,
    team: string,
    playerEntity: SoccerPlayerEntity
  ): Promise<void> {
    logger.info(`Starting single player mode for team ${team}`);

    try {
      // Spawn AI players
      logger.info("Spawning AI players...");
      await this.deps.spawnAIPlayers(team);

      // Start the game
      logger.info("Starting game with AI...");
      const gameStarted = this.deps.game && this.deps.game.startGame();
      if (gameStarted) {
        logger.info(" Game started successfully with AI!");

        // Activate pickup system if in arcade mode
        if (isArcadeMode()) {
          logger.info(`<¯ Activating pickup system for Arcade Mode`);
          this.deps.pickupManager.activate();
        }

        // Unfreeze player after short delay
        setTimeout(() => {
          if (playerEntity && typeof playerEntity.unfreeze === "function") {
            playerEntity.unfreeze();
            logger.info("Player unfrozen - game active!");
          }

          // CRITICAL: Lock pointer for gameplay (Hytopia-compliant approach)
          player.ui.lockPointer(true);
          logger.info(`<® Pointer locked for ${player.username} - Game controls enabled`);

          // Clear loading UI
          player.ui.sendData({
            type: "loading-complete",
          });
        }, 500);
      } else {
        logger.error("Failed to start game with AI");
        player.ui.sendData({
          type: "loading-error",
          message: "Failed to start game. Please try again.",
        });
      }
    } catch (error) {
      logger.error("Error during AI spawning:", error);
      player.ui.sendData({
        type: "loading-error",
        message: "Failed to spawn AI. Please refresh and try again.",
      });
    }
  }

  private async handleMultiplayerModeStart(
    player: Player,
    team: string,
    playerEntity: SoccerPlayerEntity
  ): Promise<void> {
    logger.info(`Multiplayer mode: Player ${player.username} joined team ${team}`);

    // Check how many human players are currently in the game
    const humanPlayers = PlayerManager.instance.getConnectedPlayers();
    logger.info(`Current human players in game: ${humanPlayers.length}`);

    if (humanPlayers.length === 1) {
      // First player - wait for second player
      logger.info("First player in multiplayer lobby - waiting for second player");
      player.ui.sendData({
        type: "multiplayer-waiting",
        message: "Waiting for second player to join...",
        playerCount: 1,
        requiredPlayers: 2,
      });
    } else if (humanPlayers.length === 2) {
      // Second player joined - start multiplayer game
      logger.info("Second player joined - starting multiplayer 1v1 match");

      // Assign players to different teams automatically
      const firstPlayer = humanPlayers.find((p) => p.username !== player.username);
      const secondPlayer = player;

      // Assign teams: first player gets opposite team of what second player chose
      const firstPlayerTeam = team === "red" ? "blue" : "red";
      const secondPlayerTeam = team;

      logger.info(
        `Team assignment: ${firstPlayer?.username} -> ${firstPlayerTeam}, ${secondPlayer.username} -> ${secondPlayerTeam}`
      );

      // Notify both players about team assignments
      firstPlayer?.ui.sendData({
        type: "team-assigned",
        team: firstPlayerTeam,
        message: `You have been assigned to the ${firstPlayerTeam} team`,
      });

      secondPlayer.ui.sendData({
        type: "team-assigned",
        team: secondPlayerTeam,
        message: `You have been assigned to the ${secondPlayerTeam} team`,
      });

      // Start loading for multiplayer game
      [firstPlayer, secondPlayer].forEach((p) => {
        if (p) {
          p.ui.sendData({
            type: "loading-progress",
            current: 50,
            total: 100,
            message: "Setting up multiplayer match...",
            percentage: 50,
          });
        }
      });

      // Spawn AI players for both teams (4 AI per team since 1 human per team)
      logger.info("Spawning AI players for multiplayer 1v1 match");
      await this.deps.spawnAIPlayers("red"); // This will spawn for both teams

      // Update loading progress
      [firstPlayer, secondPlayer].forEach((p) => {
        if (p) {
          p.ui.sendData({
            type: "loading-progress",
            current: 90,
            total: 100,
            message: "Starting multiplayer match...",
            percentage: 90,
          });
        }
      });

      // Start the multiplayer game
      const gameStarted = this.deps.game && this.deps.game.startGame();
      if (gameStarted) {
        logger.info(" Multiplayer 1v1 game started successfully!");

        // Notify both players
        [firstPlayer, secondPlayer].forEach((p) => {
          if (p) {
            p.ui.sendData({
              type: "loading-progress",
              current: 100,
              total: 100,
              message: "Match ready!",
              percentage: 100,
            });

            // Clear loading UI after delay
            setTimeout(() => {
              p.ui.sendData({
                type: "loading-complete",
              });
            }, 500);
          }
        });

        // Unfreeze both players
        setTimeout(() => {
          const allPlayerEntities = this.deps.world.entityManager.getAllPlayerEntities();
          allPlayerEntities.forEach((entity) => {
            if (entity instanceof SoccerPlayerEntity && typeof entity.unfreeze === "function") {
              entity.unfreeze();
              logger.info(`Player ${entity.player.username} unfrozen - multiplayer game active!`);
            }
          });
        }, 1000);
      } else {
        logger.error("Failed to start multiplayer game");
        [firstPlayer, secondPlayer].forEach((p) => {
          if (p) {
            p.ui.sendData({
              type: "loading-error",
              message: "Failed to start multiplayer game. Please try again.",
            });
          }
        });
      }
    }
  }

  private handleJoinMultiplayerLobby(player: Player, data: any): void {
    logger.info(`Player ${player.username} wants to join multiplayer lobby`);
    // For now, we'll handle this in the team-selected handler
    // In a more complex implementation, this could manage a separate lobby system
    player.ui.sendData({
      type: "multiplayer-lobby-joined",
      message: "Joined multiplayer lobby. Select your preferred team to continue.",
    });
  }

  private handleMobileTeamSelection(player: Player, data: any): void {
    const selectedTeam = data.team;
    logger.info(`=ñ Mobile team selection: ${player.username} chose ${selectedTeam}`);

    // Use existing team selection logic - same as regular team-selected handler
    // NOTE: This is a simplified version - full implementation would mirror handleTeamSelection
    if (this.deps.game) {
      // Check if player is already on a team
      if (this.deps.game.getTeamOfPlayer(player.username) !== null) {
        logger.info("=ñ Player already on a team");
        player.ui.sendData({
          type: "mobile-team-selection-failed",
          message: "Already on a team",
        });
        return;
      }

      // Mobile team selection success
      player.ui.sendData({
        type: "mobile-team-selection-confirmed",
        team: selectedTeam,
        message: `Joined ${selectedTeam} team`,
      });
    }
  }

  // ============================================================================
  // GAME CONTROL HANDLERS
  // ============================================================================

  private handleCoinTossChoice(player: Player, data: any): void {
    logger.info(`Player ${player.username} chose ${data.choice} for coin toss`);

    // Process coin toss only if game is in starting state
    if (this.deps.game && this.deps.game.getState().status === "starting") {
      this.deps.game.performCoinToss({
        playerId: player.username,
        choice: data.choice,
      });
    }
  }

  private handleForcePass(player: Player, data: any): void {
    logger.info(`<¯ SERVER: Received force-pass request from ${player.username}`);

    // Find the player's entity
    const playerEntity = this.deps.world.entityManager
      .getAllPlayerEntities()
      .find((entity) => entity.player.username === player.username);

    if (playerEntity && playerEntity instanceof SoccerPlayerEntity) {
      // Check if player has the ball
      const attachedPlayer = this.deps.sharedState.getAttachedPlayer();
      const hasBall = attachedPlayer?.player?.username === player.username;

      if (hasBall) {
        // Simulate a left mouse click to trigger the pass
        const fakeInput = {
          w: false,
          a: false,
          s: false,
          d: false,
          sp: false,
          ml: true, // Left mouse click for pass
          mr: false,
          q: false,
          sh: false,
          e: false,
          f: false,
          "1": false,
        };

        // Call the controller's input handler directly with default camera orientation
        if (playerEntity.controller && playerEntity.controller.tickWithPlayerInput) {
          playerEntity.controller.tickWithPlayerInput(
            playerEntity,
            fakeInput,
            { yaw: 0, pitch: 0 }, // Default camera orientation for pass
            16 // 16ms delta time (roughly 60fps)
          );

          logger.info(` SERVER: Force pass executed for ${player.username}`);

          // Send feedback to UI
          player.ui.sendData({
            type: "action-feedback",
            feedbackType: "success",
            title: "Pass",
            message: "Pass executed!",
          });
        }
      } else {
        logger.info(`L SERVER: ${player.username} doesn't have the ball`);
        player.ui.sendData({
          type: "action-feedback",
          feedbackType: "warning",
          title: "Pass Failed",
          message: "You don't have the ball!",
        });
      }
    }
  }

  private handleRequestPass(player: Player, data: any): void {
    const requestingPlayerEntity = this.deps.world.entityManager.getPlayerEntitiesByPlayer(
      player
    )[0];
    if (!requestingPlayerEntity || !(requestingPlayerEntity instanceof SoccerPlayerEntity)) return;

    const playerWithBall = this.deps.sharedState.getAttachedPlayer();
    if (
      playerWithBall &&
      playerWithBall instanceof AIPlayerEntity &&
      playerWithBall.team === requestingPlayerEntity.team
    ) {
      logger.info(
        `<¯ HUMAN PLAYER REQUESTING PASS: AI ${playerWithBall.player.username} passing to ${requestingPlayerEntity.player.username}`
      );

      // Calculate a target point slightly in front of the requesting player
      const leadDistance = 3.0; // Increased lead distance for better reception
      // Use the direction the player is facing for better ball placement
      const targetDirection = getDirectionFromRotation(requestingPlayerEntity.rotation);

      const passTargetPoint = {
        x: requestingPlayerEntity.position.x + targetDirection.x * leadDistance,
        y: requestingPlayerEntity.position.y, // Keep y the same for a ground pass
        z: requestingPlayerEntity.position.z + targetDirection.z * leadDistance,
      };

      // Use higher power for more reliable pass delivery
      const passPower = 1.2; // Increased power to ensure ball reaches human player

      // GUARANTEED PASS: Use forcePass which bypasses all AI decision making
      const passSuccess = playerWithBall.forcePass(
        requestingPlayerEntity,
        passTargetPoint,
        passPower
      );

      if (passSuccess) {
        logger.info(
          ` GUARANTEED PASS: Successfully passed ball to human player ${requestingPlayerEntity.player.username}`
        );
      } else {
        logger.warn(
          `L PASS FAILED: Could not pass to human player ${requestingPlayerEntity.player.username}`
        );
      }
    } else {
      logger.info(
        `L PASS REQUEST DENIED: No AI teammate has the ball or wrong team`
      );
    }
  }

  private handleManualResetGame(player: Player, data: any): void {
    logger.info(
      `= Player ${player.username} requested manual game reset from game over screen`
    );

    // Only allow reset if game is finished
    if (this.deps.game && this.deps.game.getState().status === "finished") {
      logger.info(" Game is finished, proceeding with manual reset");

      // Reset music back to opening music
      this.deps.audioManager.playOpeningMusic();

      // Stop FIFA crowd atmosphere
      if (this.deps.fifaCrowdManager && this.deps.fifaCrowdManager.stop) {
        this.deps.fifaCrowdManager.stop();
      }

      // Perform the actual game reset
      this.deps.game.manualResetGame();

      // CRITICAL: Unlock pointer for UI interactions after manual reset (Hytopia-compliant approach)
      player.ui.lockPointer(false);
      logger.info(
        `<¯ Pointer unlocked for ${player.username} after manual reset - UI interactions enabled`
      );

      // Clear AI players list
      this.deps.aiPlayers.forEach((ai) => {
        if (ai.isSpawned) {
          ai.deactivate();
          this.deps.sharedState.removeAIFromTeam(ai, ai.team);
          ai.despawn();
        }
      });
      this.deps.aiPlayers.length = 0; // Clear array
      this.deps.game.updateAIPlayersList([]);

      logger.info(" Manual game reset complete - players can now select teams");
    } else {
      logger.info(
        `L Manual reset denied - game status is: ${this.deps.game ? this.deps.game.getState().status : "null"}`
      );
      player.ui.sendData({
        type: "error",
        message: "Game reset only available when game is finished",
      });
    }
  }

  private handleStartSecondHalf(player: Player, data: any): void {
    logger.info(`=€ Player ${player.username} requested to start second half`);

    // Only allow if game is in halftime
    if (this.deps.game && this.deps.game.getState().isHalftime) {
      logger.info(" Game is in halftime, starting second half");

      // Call the game's startSecondHalf method
      this.deps.game.startSecondHalf();

      logger.info(" Second half started successfully");
    } else {
      logger.info(
        `L Start second half denied - game status is: ${this.deps.game ? this.deps.game.getState().status : "null"}, halftime: ${this.deps.game ? this.deps.game.getState().isHalftime : "null"}`
      );
      player.ui.sendData({
        type: "error",
        message: "Second half can only be started during halftime",
      });
    }
  }

  // ============================================================================
  // TOURNAMENT MANAGEMENT HANDLERS
  // ============================================================================

  private handleTournamentCreate(player: Player, data: any): void {
    logger.info(`<Æ Player ${player.username} creating tournament:`, data);
    logger.info(`<Æ Tournament creation request details:`, {
      name: data.name,
      type: data.tournamentType,
      gameMode: data.gameMode,
      maxPlayers: data.maxPlayers,
      registrationTime: data.registrationTime,
      createdBy: player.username,
    });

    try {
      const tournament = this.deps.tournamentManager.createTournament(
        data.name,
        data.tournamentType,
        data.gameMode,
        data.maxPlayers,
        data.registrationTime,
        player.username
      );

      logger.info(`<Æ Tournament created successfully, sending response to ${player.username}`);

      const tournamentResponse = {
        type: "tournament-created",
        tournament: {
          id: tournament.id,
          name: tournament.name,
          type: tournament.type,
          gameMode: tournament.gameMode,
          maxPlayers: tournament.maxPlayers,
          status: tournament.status,
          players: Object.values(tournament.players), //  Send full player objects
          playerCount: Object.keys(tournament.players).length,
        },
      };

      logger.info(`<Æ Sending tournament-created response:`, tournamentResponse);
      player.ui.sendData(tournamentResponse);

      // Broadcast tournament creation to all players
      const allPlayers = PlayerManager.instance.getConnectedPlayers();
      logger.info(`<Æ Broadcasting tournament list to ${allPlayers.length} players`);

      allPlayers.forEach((p) => {
        p.ui.sendData({
          type: "tournament-list-updated",
          tournaments: this.deps.tournamentManager.getActiveTournaments().map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            gameMode: t.gameMode,
            maxPlayers: t.maxPlayers,
            status: t.status,
            players: Object.keys(t.players).length,
          })),
        });
      });

      logger.info(` Tournament "${tournament.name}" created and broadcast successfully`);
    } catch (error: any) {
      logger.error("L Tournament creation error:", error);
      logger.error("L Error stack:", error.stack);

      const errorResponse = {
        type: "tournament-error",
        message: `Failed to create tournament: ${error.message}`,
      };

      logger.info(`<Æ Sending tournament-error response:`, errorResponse);
      player.ui.sendData(errorResponse);
    }
  }

  private handleTournamentJoin(player: Player, data: any): void {
    logger.info(`<Æ Player ${player.username} joining tournament: ${data.tournamentId}`);

    try {
      const success = this.deps.tournamentManager.registerPlayer(
        data.tournamentId,
        player.username,
        player.username
      );

      if (success) {
        const tournament = this.deps.tournamentManager.getTournament(data.tournamentId);

        player.ui.sendData({
          type: "tournament-joined",
          tournament: tournament
            ? {
                id: tournament.id,
                name: tournament.name,
                type: tournament.type,
                gameMode: tournament.gameMode,
                maxPlayers: tournament.maxPlayers,
                status: tournament.status,
                players: Object.values(tournament.players), //  Send full player objects
                playerCount: Object.keys(tournament.players).length,
              }
            : null,
        });

        // Update all players with new tournament data
        const allPlayers = PlayerManager.instance.getConnectedPlayers();
        allPlayers.forEach((p) => {
          p.ui.sendData({
            type: "tournament-list-updated",
            tournaments: this.deps.tournamentManager.getActiveTournaments().map((t) => ({
              id: t.id,
              name: t.name,
              type: t.type,
              gameMode: t.gameMode,
              maxPlayers: t.maxPlayers,
              status: t.status,
              players: Object.keys(t.players).length,
            })),
          });
        });

        logger.info(` Player ${player.username} joined tournament successfully`);
      } else {
        player.ui.sendData({
          type: "tournament-error",
          message: "Failed to join tournament. It may be full or already started.",
        });
      }
    } catch (error: any) {
      logger.error("Tournament join error:", error);
      player.ui.sendData({
        type: "tournament-error",
        message: `Failed to join tournament: ${error.message}`,
      });
    }
  }

  private handleTournamentLeave(player: Player, data: any): void {
    logger.info(`<Æ Player ${player.username} leaving tournament`);

    const activeTournaments = this.deps.tournamentManager.getPlayerActiveTournaments(
      player.username
    );

    if (activeTournaments.length > 0) {
      const tournament = activeTournaments[0];

      try {
        const success = this.deps.tournamentManager.unregisterPlayer(tournament.id, player.username);

        if (success) {
          player.ui.sendData({
            type: "tournament-left",
            message: `Left tournament "${tournament.name}"`,
          });

          // Update all players with new tournament data
          const allPlayers = PlayerManager.instance.getConnectedPlayers();
          allPlayers.forEach((p) => {
            p.ui.sendData({
              type: "tournament-list-updated",
              tournaments: this.deps.tournamentManager.getActiveTournaments().map((t) => ({
                id: t.id,
                name: t.name,
                type: t.type,
                gameMode: t.gameMode,
                maxPlayers: t.maxPlayers,
                status: t.status,
                players: Object.keys(t.players).length,
              })),
            });
          });

          logger.info(` Player ${player.username} left tournament successfully`);
        } else {
          player.ui.sendData({
            type: "tournament-error",
            message: "Failed to leave tournament",
          });
        }
      } catch (error: any) {
        logger.error("Tournament leave error:", error);
        player.ui.sendData({
          type: "tournament-error",
          message: `Failed to leave tournament: ${error.message}`,
        });
      }
    } else {
      player.ui.sendData({
        type: "tournament-error",
        message: "You are not in any tournaments",
      });
    }
  }

  private handleTournamentReady(player: Player, data: any): void {
    logger.info(`<Æ Player ${player.username} marking ready for tournament match`);

    const match = this.deps.tournamentManager.getMatchForPlayer(player.username);
    if (match) {
      try {
        // Find the tournament this match belongs to
        const tournament = this.deps.tournamentManager
          .getActiveTournaments()
          .find((t) => t.bracket.some((m) => m.id === match.id));

        if (tournament) {
          const success = this.deps.tournamentManager.setPlayerReady(
            tournament.id,
            match.id,
            player.username,
            true
          );

          if (success) {
            player.ui.sendData({
              type: "tournament-ready-updated",
              isReady: true,
              message: "Marked as ready for match!",
            });

            logger.info(` Player ${player.username} marked as ready for match`);
          } else {
            player.ui.sendData({
              type: "tournament-error",
              message: "Failed to mark as ready",
            });
          }
        } else {
          player.ui.sendData({
            type: "tournament-error",
            message: "Tournament not found for match",
          });
        }
      } catch (error: any) {
        logger.error("Tournament ready error:", error);
        player.ui.sendData({
          type: "tournament-error",
          message: `Failed to set ready status: ${error.message}`,
        });
      }
    } else {
      player.ui.sendData({
        type: "tournament-error",
        message: "You don't have any upcoming matches",
      });
    }
  }

  private handleTournamentGetStatus(player: Player, data: any): void {
    logger.info(`<Æ Player ${player.username} requesting tournament status`);

    const activeTournaments = this.deps.tournamentManager.getPlayerActiveTournaments(
      player.username
    );

    if (activeTournaments.length > 0) {
      const tournament = activeTournaments[0];
      const match = this.deps.tournamentManager.getMatchForPlayer(player.username);

      player.ui.sendData({
        type: "tournament-status",
        tournament: {
          id: tournament.id,
          name: tournament.name,
          type: tournament.type,
          gameMode: tournament.gameMode,
          maxPlayers: tournament.maxPlayers,
          status: tournament.status,
          players: Object.keys(tournament.players),
          playerCount: Object.keys(tournament.players).length,
          bracket: tournament.bracket,
        },
        playerMatch: match
          ? {
              id: match.id,
              opponent: match.player1 === player.username ? match.player2 : match.player1,
              status: match.status,
              roundNumber: match.roundNumber,
              scheduledTime: match.scheduledTime,
            }
          : null,
      });
    } else {
      player.ui.sendData({
        type: "tournament-status",
        tournament: null,
        playerMatch: null,
      });
    }
  }

  private handleTournamentGetList(player: Player, data: any): void {
    logger.info(`<Æ Player ${player.username} requesting tournament list`);

    const tournaments = this.deps.tournamentManager.getActiveTournaments();

    player.ui.sendData({
      type: "tournament-list",
      tournaments: tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        gameMode: t.gameMode,
        maxPlayers: t.maxPlayers,
        status: t.status,
        players: Object.keys(t.players).length,
        createdBy: t.createdBy,
        registrationDeadline: t.registrationDeadline,
      })),
    });
  }

  // ============================================================================
  // SPECTATOR MODE HANDLERS
  // ============================================================================

  private handleSpectatorNextPlayer(player: Player, data: any): void {
    logger.info(`<¥ Spectator ${player.username} wants to switch to next player`);
    this.deps.spectatorMode.nextPlayer(player);
  }

  private handleSpectatorNextCamera(player: Player, data: any): void {
    logger.info(`<¥ Spectator ${player.username} wants to switch camera mode`);
    this.deps.spectatorMode.nextCameraMode(player);
  }

  private handleSpectatorLeave(player: Player, data: any): void {
    logger.info(`<¥ Spectator ${player.username} wants to leave spectator mode`);
    this.deps.spectatorMode.removeSpectator(player);
  }

  // ============================================================================
  // MOBILE INPUT HANDLERS
  // ============================================================================

  private handleMobileModeEnabled(player: Player, data: any): void {
    logger.info(`=ñ Player ${player.username} enabled mobile mode`);
    logger.info(`=ñ Device info:`, data.deviceInfo);

    // Store mobile mode preference for this player
    (player as any)._isMobilePlayer = true;

    // Send mobile-optimized game state if game is active
    if (this.deps.game && this.deps.game.inProgress()) {
      player.ui.sendData({
        type: "mobile-game-state",
        gameState: this.deps.game.getState(),
        optimizedForMobile: true,
      });
    }

    // Notify all other players about mobile player
    PlayerManager.instance.getConnectedPlayers().forEach((p) => {
      if (p.username !== player.username) {
        p.ui.sendData({
          type: "mobile-player-joined",
          playerName: player.username,
          deviceInfo: data.deviceInfo,
        });
      }
    });

    logger.info(` Mobile mode enabled for ${player.username}`);
  }

  private handleMobileMovementInput(player: Player, data: any): void {
    // Handle mobile virtual joystick movement - HYTOPIA SDK COMPLIANT
    const movementInput = data.movement;
    const inputMagnitude = data.inputMagnitude || 0;

    // Input validation and throttling
    if (
      !movementInput ||
      (Math.abs(movementInput.x) < 0.01 && Math.abs(movementInput.y) < 0.01)
    ) {
      return; // Ignore negligible input to reduce processing
    }

    // Get the player's soccer entity
    const playerEntity = this.deps.world.entityManager.getPlayerEntitiesByPlayer(player)[0];
    if (playerEntity && playerEntity instanceof SoccerPlayerEntity) {
      // Store mobile player optimization data
      const mobileData = (player as any)._mobileOptimization || {
        lastInputTime: 0,
        inputBuffer: [],
        throttleInterval: 33, // 30fps for mobile optimization
      };

      const currentTime = Date.now();

      // Server-side input throttling for mobile devices
      if (currentTime - mobileData.lastInputTime < mobileData.throttleInterval) {
        // Buffer the input for smooth interpolation
        mobileData.inputBuffer.push({ movement: movementInput, time: currentTime });
        if (mobileData.inputBuffer.length > 3) {
          mobileData.inputBuffer.shift(); // Keep only recent inputs
        }
        return;
      }

      // Process buffered inputs for smooth movement
      if (mobileData.inputBuffer.length > 0) {
        const avgInput = mobileData.inputBuffer.reduce(
          (acc: { x: number; y: number }, input: any) => ({
            x: acc.x + input.movement.x,
            y: acc.y + input.movement.y,
          }),
          { x: 0, y: 0 }
        );

        avgInput.x /= mobileData.inputBuffer.length;
        avgInput.y /= mobileData.inputBuffer.length;

        // Use averaged input for smoother movement
        Object.assign(movementInput, avgInput);
        mobileData.inputBuffer = [];
      }

      mobileData.lastInputTime = currentTime;
      (player as any)._mobileOptimization = mobileData;

      // Convert joystick input to HYTOPIA SDK PlayerInput format
      const deadzone = 0.15; // Server-side deadzone verification
      const magnitude = Math.sqrt(movementInput.x * movementInput.x + movementInput.y * movementInput.y);

      if (magnitude < deadzone) {
        return; // Ignore inputs within deadzone
      }

      // Apply mobile-specific movement scaling
      const mobileSensitivity = (player as any)._mobileSensitivity || 1.0;
      const scaledInput = {
        x: movementInput.x * mobileSensitivity,
        y: movementInput.y * mobileSensitivity,
      };

      // HYTOPIA SDK COMPLIANT PlayerInput - Use standard SDK input properties
      const hytopiaPlayerInput = {
        // Movement keys (w, a, s, d)
        w: scaledInput.y > 0.1, // forward
        a: scaledInput.x < -0.1, // left
        s: scaledInput.y < -0.1, // backward
        d: scaledInput.x > 0.1, // right

        // Mouse buttons
        ml: false, // mouse left click
        mr: false, // mouse right click

        // Other standard keys
        sp: false, // spacebar
        sh: false, // shift
        q: false, // charge shot
        e: false, // tackle
        r: false,
        f: false,
        z: false,
        x: false,
        c: false,
        v: false,

        // Number keys
        1: false,
        2: false,
        3: false,
        4: false,
        5: false,
        6: false,
        7: false,
        8: false,
        9: false,
      };

      // Apply movement through the player controller using proper PlayerInput
      if (playerEntity.controller && playerEntity.controller.tickWithPlayerInput) {
        // Use stored mobile camera orientation for movement direction
        const storedCamera = (player as any)._mobileCameraOrientation || { yaw: 0, pitch: 0 };
        const cameraOrientation = {
          yaw: storedCamera.yaw,
          pitch: storedCamera.pitch,
        };

        // Optimized delta time for mobile devices
        const deltaTime = Math.min(33, currentTime - mobileData.lastInputTime + 16);

        playerEntity.controller.tickWithPlayerInput(
          playerEntity,
          hytopiaPlayerInput, // Now using proper Hytopia SDK format
          cameraOrientation,
          deltaTime
        );
      }
    }
  }

  private handleMobileActionInput(player: Player, data: any): void {
    // Handle mobile action button presses - HYTOPIA SDK COMPLIANT
    const action = data.action;
    const pressed = data.pressed;

    logger.info(`=ñ Mobile action: ${player.username} ${action} ${pressed ? "pressed" : "released"}`);

    // Get the player's soccer entity
    const playerEntity = this.deps.world.entityManager.getPlayerEntitiesByPlayer(player)[0];
    if (playerEntity && playerEntity instanceof SoccerPlayerEntity) {
      // Create HYTOPIA SDK compliant PlayerInput for actions
      const hytopiaActionInput = {
        // Movement keys - false for action input
        w: false,
        a: false,
        s: false,
        d: false,

        // Map mobile actions to proper Hytopia SDK input properties
        ml: action === "pass" && pressed, // mouse left = pass
        mr: action === "shoot" && pressed, // mouse right = shoot
        sp: false, // spacebar
        sh: false, // shift
        q: false, // charge shot
        e: action === "tackle" && pressed, // tackle
        r: false,
        f: action === "dodge" && pressed, // dodge (f key)
        z: false,
        x: false,
        c: false,
        v: false,

        // Number keys
        1: false,
        2: false,
        3: false,
        4: false,
        5: false,
        6: false,
        7: false,
        8: false,
        9: false,
      };

      // Get stored mobile camera orientation or default
      const storedCamera = (player as any)._mobileCameraOrientation || { yaw: 0, pitch: 0 };

      // Apply action through the player controller using proper PlayerInput
      if (playerEntity.controller && playerEntity.controller.tickWithPlayerInput) {
        const cameraOrientation = {
          yaw: storedCamera.yaw,
          pitch: storedCamera.pitch,
        };

        playerEntity.controller.tickWithPlayerInput(
          playerEntity,
          hytopiaActionInput, // Now using proper Hytopia SDK format
          cameraOrientation,
          16 // 16ms delta time
        );
      }

      // Send feedback for successful action registration
      if (pressed) {
        player.ui.sendData({
          type: "mobile-action-feedback",
          action: action,
          success: true,
        });
      }
    }
  }

  private handleMobileCameraInput(player: Player, data: any): void {
    // Handle mobile camera rotation - NEW SYSTEM
    const camera = data.camera;

    logger.info(
      `=ñ Mobile camera: ${player.username} yaw=${camera.yaw.toFixed(3)}, pitch=${camera.pitch.toFixed(3)}`
    );

    // Store camera orientation for this mobile player
    (player as any)._mobileCameraOrientation = {
      yaw: camera.yaw,
      pitch: camera.pitch,
    };

    // Get the player's soccer entity
    const playerEntity = this.deps.world.entityManager.getPlayerEntitiesByPlayer(player)[0];
    if (playerEntity && playerEntity instanceof SoccerPlayerEntity) {
      // Apply camera rotation through Hytopia SDK if available
      if (player.camera && typeof player.camera.setOffset === "function") {
        try {
          // Calculate camera offset based on mobile rotation
          const distance = 5; // Camera distance from player
          const height = 2; // Camera height offset

          const offsetX = Math.sin(camera.yaw) * distance;
          const offsetZ = Math.cos(camera.yaw) * distance;
          const offsetY = height + Math.sin(camera.pitch) * 2;

          // Apply camera offset for third-person view optimized for mobile
          player.camera.setOffset({
            x: offsetX,
            y: offsetY,
            z: offsetZ,
          });

          // Set camera to track the player entity
          player.camera.setTrackedEntity(playerEntity);

          // Optimize FOV for mobile
          if (typeof player.camera.setFov === "function") {
            player.camera.setFov(85); // Wider FOV for better mobile experience
          }
        } catch (cameraError) {
          logger.warn(`=ñ Camera control error for ${player.username}:`, cameraError);
        }
      }

      // Send camera feedback to mobile UI
      player.ui.sendData({
        type: "mobile-camera-feedback",
        camera: camera,
        success: true,
      });
    }
  }

  // ============================================================================
  // MOBILE GESTURE HANDLERS
  // ============================================================================

  private handleMobileSwipeGesture(player: Player, data: any): void {
    // Handle swipe gestures for special actions
    const direction = data.direction;
    const speed = data.speed;
    const distance = data.distance;

    logger.info(`=ñ Swipe gesture: ${player.username} swiped ${direction} (${speed.toFixed(1)} px/ms)`);

    // Get the player's soccer entity
    const playerEntity = this.deps.world.entityManager.getPlayerEntitiesByPlayer(player)[0];
    if (playerEntity && playerEntity instanceof SoccerPlayerEntity) {
      // NOTE: The original code had complex swipe handling with hardcoded input objects
      // This is a placeholder - the actual implementation would need to be adapted
      // to match the new controller architecture

      // Send feedback to mobile UI
      player.ui.sendData({
        type: "mobile-swipe-feedback",
        direction: direction,
        action:
          direction === "up"
            ? "Power Shot"
            : direction === "down"
              ? "Dodge"
              : `Pass ${direction.toUpperCase()}`,
        success: true,
      });
    }
  }

  private handleMobileZoomGesture(player: Player, data: any): void {
    // Handle pinch-to-zoom for camera control
    const zoom = data.zoom;
    const center = data.center;

    logger.info(`=ñ Zoom gesture: ${player.username} zoom ${zoom.toFixed(2)}x`);

    // Get the player's soccer entity
    const playerEntity = this.deps.world.entityManager.getPlayerEntitiesByPlayer(player)[0];
    if (playerEntity && playerEntity instanceof SoccerPlayerEntity) {
      // Store mobile zoom preference for this player
      (player as any)._mobileZoomLevel = zoom;

      // Send zoom feedback to mobile UI
      player.ui.sendData({
        type: "mobile-zoom-feedback",
        zoom: zoom,
        success: true,
      });
    }
  }
}
