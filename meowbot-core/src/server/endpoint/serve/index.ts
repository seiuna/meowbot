import { Module } from "@nestjs/common";
import { ServeController } from "./serve.controller.js";

@Module({ controllers: [ServeController] })
export class ServeModule {}
