/**
 * Copyright (C) 2021 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import { Server } from './server';
import { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';

const MIN_LENGTH_API_TOKEN = 32;
export const NAME_HEADER_API_TOKEN = 'diva-api-token';

export class Api {
  private package: any = require('../../package.json');
  private server: Server;
  private readonly pathToken: string;
  private token: string = '';

  static make(server: Server) {
    return new Api(server);
  }

  private constructor(server: Server) {
    this.server = server;

    const config = this.server.config;
    this.pathToken = path.join(config.path_keys, config.address.replace(/[^a-z0-9_-]+/gi, '-') + '.api-token');
    this.createToken();
    this.route();
  }

  private createToken() {
    const l = Math.floor((Math.random() * MIN_LENGTH_API_TOKEN) / 3) + MIN_LENGTH_API_TOKEN;
    fs.writeFileSync(this.pathToken, nanoid(l), { mode: '0600' });
    this.token = fs.readFileSync(this.pathToken).toString();
    setTimeout(() => {
      this.createToken();
    }, 1000 * 60 * (Math.floor(Math.random() * 5) + 3)); // between 3 and 8 minutes
  }

  private route() {
    this.server.app.get('/join/:address/:publicKey', (req: Request, res: Response) => {
      return this.server.getBootstrap().join(req.params.address, req.params.publicKey)
        ? res.status(200).json({ address: req.params.address, publicKey: req.params.publicKey })
        : res.status(403).end();
    });

    this.server.app.get('/challenge/:token', (req: Request, res: Response) => {
      const signedToken = this.server.getBootstrap().challenge(req.params.token);
      return signedToken ? res.status(200).json({ token: signedToken }) : res.status(403).end();
    });

    this.server.app.get('/sync/:height', async (req: Request, res: Response) => {
      const h = Math.floor(Number(req.params.height) || 0);
      try {
        return res.json(await this.server.getBlockchain().getRange(h, h + this.server.config.network_sync_size));
      } catch (error: any) {
        return res.status(404).end();
      }
    });

    this.server.app.get('/about', (req: Request, res: Response) => {
      return res.json({
        version: this.package.version,
        license: this.package.license,
        publicKey: this.server.getWallet().getPublicKey(),
      });
    });

    this.server.app.get('/peers', (req: Request, res: Response) => {
      return res.json(this.server.getNetwork().peers());
    });

    this.server.app.get('/network', (req: Request, res: Response) => {
      return res.json(this.server.getNetwork().network());
    });

    this.server.app.get('/state/:key?', async (req: Request, res: Response) => {
      const key = req.params.key || '';
      try {
        return res.json(await this.server.getBlockchain().getState(key));
      } catch (error: any) {
        return res.status(404).end();
      }
    });

    this.server.app.get('/stack/transactions', (req: Request, res: Response) => {
      return res.json(this.server.getPool().getStack());
    });

    this.server.app.get('/pool/transactions', (req: Request, res: Response) => {
      return res.json(this.server.getPool().get());
    });

    this.server.app.get('/block/genesis', async (req: Request, res: Response) => {
      return res.json((await this.server.getBlockchain().getRange(1, 1))[0]);
    });

    this.server.app.get('/block/latest', async (req: Request, res: Response) => {
      return res.json(this.server.getBlockchain().getLatestBlock());
    });

    this.server.app.get('/block/:height', async (req: Request, res: Response) => {
      const h = Math.floor(Number(req.params.height || 0));
      if (h < 1 || h > this.server.getBlockchain().getHeight()) {
        return res.status(404).end();
      }
      return res.json((await this.server.getBlockchain().getRange(h, h))[0]);
    });

    this.server.app.get('/blocks/:gte?/:lte?', async (req: Request, res: Response) => {
      const gte = Number(typeof req.params.gte === 'undefined' ? 1 : req.params.gte);
      const lte = Number(req.params.lte || 0);
      if (gte < 1) {
        return res.status(404).end();
      }
      return res.json(await this.server.getBlockchain().getRange(gte, lte));
    });

    this.server.app.get('/blocks/page/:page/:size?', async (req: Request, res: Response) => {
      const page = Number(req.params.page || 1);
      const size = Number(req.params.size || 0);
      try {
        return res.json(await this.server.getBlockchain().getPage(page, size));
      } catch (error: any) {
        return res.status(404).end();
      }
    });

    this.server.app.get('/transaction/:origin/:ident', async (req: Request, res: Response) => {
      const origin = req.params.origin || '';
      const ident = req.params.ident || '';
      if (!origin || !ident) {
        return res.status(404).end();
      }
      try {
        return res.json(await this.server.getBlockchain().getTransaction(origin, ident));
      } catch (error: any) {
        return res.status(404).end();
      }
    });

    //@FIXME API KEY!
    this.server.app.put('/transaction/:ident?', async (req: Request, res: Response) => {
      const ident = this.server.stackTxProposal(req.body, req.params.ident);
      if (ident) {
        this.server.releaseTxProposal();
        return res.json({ ident: ident });
      }
      res.status(403).end();
    });

    this.server.app.get('/debug/performance/:height', async (req: Request, res: Response) => {
      const height = Number(req.params.height || 0);
      return res.json(await this.server.getBlockchain().getPerformance(height));
    });
  }
}
