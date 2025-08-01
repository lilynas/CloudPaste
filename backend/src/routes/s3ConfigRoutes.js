/**
 * S3存储配置路由
 */
import { Hono } from "hono";
import { authGateway } from "../middlewares/authGatewayMiddleware.js";
import {
  getS3ConfigsByAdmin,
  getPublicS3Configs,
  getS3ConfigByIdForAdmin,
  getPublicS3ConfigById,
  createS3Config,
  updateS3Config,
  deleteS3Config,
  setDefaultS3Config,
  testS3Connection,
  getS3ConfigsWithUsage,
} from "../services/s3ConfigService.js";
import { DbTables, ApiStatus } from "../constants/index.js";
import { createErrorResponse } from "../utils/common.js";
import { HTTPException } from "hono/http-exception";
import { decryptValue } from "../utils/crypto.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createS3Client } from "../utils/s3Utils.js";

const s3ConfigRoutes = new Hono();

// 获取S3配置列表（管理员权限或API密钥文件权限）
s3ConfigRoutes.get("/api/s3-configs", authGateway.requireFile(), async (c) => {
  const db = c.env.DB;

  try {
    let configs;
    const isAdmin = authGateway.utils.isAdmin(c);
    const adminId = authGateway.utils.getUserId(c);

    if (isAdmin) {
      // 管理员可以看到所有自己的配置
      configs = await getS3ConfigsByAdmin(db, adminId);
    } else {
      // API密钥用户只能看到公开的配置
      configs = await getPublicS3Configs(db);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取S3配置列表成功",
      data: configs,
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("获取S3配置列表错误:", error);
    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, error.message || "获取S3配置列表失败"), ApiStatus.INTERNAL_ERROR);
  }
});

// 获取单个S3配置详情
s3ConfigRoutes.get("/api/s3-configs/:id", authGateway.requireFile(), async (c) => {
  const db = c.env.DB;
  const { id } = c.req.param();

  try {
    let config;
    const isAdmin = authGateway.utils.isAdmin(c);
    const adminId = authGateway.utils.getUserId(c);

    if (isAdmin) {
      // 管理员查询
      config = await getS3ConfigByIdForAdmin(db, id, adminId);
    } else {
      // API密钥用户查询
      config = await getPublicS3ConfigById(db, id);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取S3配置成功",
      data: config, // 不返回敏感字段
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("获取S3配置错误:", error);
    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, error.message || "获取S3配置失败"), ApiStatus.INTERNAL_ERROR);
  }
});

// 创建S3配置（管理员权限）
s3ConfigRoutes.post("/api/s3-configs", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";

  try {
    const body = await c.req.json();
    const config = await createS3Config(db, body, adminId, encryptionSecret);

    // 返回创建成功响应
    return c.json({
      code: ApiStatus.CREATED,
      message: "S3配置创建成功",
      data: config,
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("创建S3配置错误:", error);
    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, error.message || "创建S3配置失败"), ApiStatus.INTERNAL_ERROR);
  }
});

// 更新S3配置（管理员权限）
s3ConfigRoutes.put("/api/s3-configs/:id", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const { id } = c.req.param();
  const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";

  try {
    const body = await c.req.json();
    await updateS3Config(db, id, body, adminId, encryptionSecret);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "S3配置已更新",
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("更新S3配置错误:", error);
    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, error.message || "更新S3配置失败"), ApiStatus.INTERNAL_ERROR);
  }
});

// 删除S3配置（管理员权限）
s3ConfigRoutes.delete("/api/s3-configs/:id", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const { id } = c.req.param();

  try {
    await deleteS3Config(db, id, adminId);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "S3配置删除成功",
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("删除S3配置错误:", error);
    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, error.message || "删除S3配置失败"), ApiStatus.INTERNAL_ERROR);
  }
});

// 设置默认S3配置（管理员权限）
s3ConfigRoutes.put("/api/s3-configs/:id/set-default", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const { id } = c.req.param();

  try {
    await setDefaultS3Config(db, id, adminId);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "默认S3配置设置成功",
      success: true,
    });
  } catch (error) {
    console.error("设置默认S3配置错误:", error);
    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, error.message || "设置默认S3配置失败"), ApiStatus.INTERNAL_ERROR);
  }
});

// 测试S3配置连接（管理员权限）
s3ConfigRoutes.post("/api/s3-configs/:id/test", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const { id } = c.req.param();
  const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";
  const requestOrigin = c.req.header("origin");

  try {
    const testResult = await testS3Connection(db, id, adminId, encryptionSecret, requestOrigin);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: testResult.message,
      data: {
        success: testResult.success,
        result: testResult.result,
      },
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("测试S3配置错误:", error);
    return c.json(
      {
        code: ApiStatus.INTERNAL_ERROR,
        message: error.message || "测试S3配置失败",
        data: {
          success: false,
          result: {
            error: error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : null,
          },
        },
        success: false,
      },
      ApiStatus.INTERNAL_ERROR
    );
  }
});

export default s3ConfigRoutes;
