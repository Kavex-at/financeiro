import { AsyncLocalStorage } from 'node:async_hooks';
import type { ConexosService } from '../../../services/conexos.js';

/**
 * Estado por-request para resolver QUAL sessão Conexos usar (Fatia B). O
 * middleware de identidade popula `platformUsername` (o `sub` do JWT) após a
 * autenticação; o resolver lê aqui e escolhe a sessão do usuário vinculado (ou
 * o robô). `resolved` cacheia a sessão escolhida para a request inteira, para
 * não repetir o lookup/login a cada chamada ao ERP.
 *
 * Fora de uma request (jobs, crons, scripts) o store é `undefined` → o resolver
 * cai no robô, exatamente como antes.
 */
/**
 * Identidade Conexos efetivamente escolhida para esta request (ADR-0041). Publicada pelo
 * `ConexosSessionResolver` em toda resolução dentro de request — inclusive quando degrada
 * para o robô, porque é exatamente esse caso que precisava ficar registrado.
 */
export interface ConexosResolvedIdentity {
    /** Login do ERP que vai assinar as escritas (o do usuário vinculado, ou o do robô). */
    conexosUsername: string;
    /** `true` quando a sessão usada é a do robô (sem vínculo, ou vínculo que não logou). */
    viaRobo: boolean;
}

export interface ConexosRequestState {
    platformUsername?: string;
    resolved?: ConexosService;
    identity?: ConexosResolvedIdentity;
}

export const conexosRequestContext = new AsyncLocalStorage<ConexosRequestState>();
