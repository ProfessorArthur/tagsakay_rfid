import { Hono } from "hono";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { apiKeys, users } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { generateApiKey, hashApiKey } from "../lib/auth.js";

type Env = {
  Bindings: {
    DATABASE_URL: string;
    JWT_SECRET: string;
    SESSION_SECRET: string;
  };
  Variables: {
    db: Database;
    user?: any;
  };
};

const app = new Hono<Env>();

// POST /api/keys - Create new API key (admin/superadmin only)
app.post("/", authMiddleware, requireRole("admin", "superadmin"), async (c) => {
  try {
    const db = c.get("db");
    const user = c.get("user");
    const {
      name,
      deviceId,
      description,
      permissions = ["scan"],
      type = "device",
      metadata = {},
    } = await c.req.json();

    if (!name || !deviceId) {
      return c.json(
        {
          success: false,
          message: "name and deviceId are required",
        },
        400
      );
    }

    // Generate API key with prefix
    const rawApiKey = generateApiKey();
    const prefix = `tsk_${type.substring(0, 3)}`;
    const fullApiKey = `${prefix}_${rawApiKey}`;
    const hashedKey = await hashApiKey(fullApiKey);

    // Create new API key
    const [newApiKey] = await db
      .insert(apiKeys)
      .values({
        name,
        deviceId,
        description: description || null,
        key: hashedKey,
        prefix,
        permissions,
        type,
        metadata,
        isActive: true,
        createdBy: user.id,
      })
      .returning();

    return c.json(
      {
        success: true,
        message: "API key created successfully",
        data: {
          apiKey: {
            id: newApiKey.id,
            name: newApiKey.name,
            deviceId: newApiKey.deviceId,
            description: newApiKey.description,
            prefix: newApiKey.prefix,
            permissions: newApiKey.permissions,
            type: newApiKey.type,
            isActive: newApiKey.isActive,
            createdAt: newApiKey.createdAt,
          },
          key: fullApiKey, // Return plain API key only once
        },
      },
      201
    );
  } catch (error: any) {
    console.error("Create API key error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to create API key",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/keys - List all API keys (admin/superadmin only)
app.get("/", authMiddleware, requireRole("admin", "superadmin"), async (c) => {
  try {
    const db = c.get("db");

    const allApiKeys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        deviceId: apiKeys.deviceId,
        description: apiKeys.description,
        prefix: apiKeys.prefix,
        permissions: apiKeys.permissions,
        type: apiKeys.type,
        isActive: apiKeys.isActive,
        lastUsed: apiKeys.lastUsed,
        createdAt: apiKeys.createdAt,
        createdBy: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(apiKeys)
      .leftJoin(users, eq(apiKeys.createdBy, users.id))
      .orderBy(desc(apiKeys.createdAt));

    return c.json({
      success: true,
      message: `Retrieved ${allApiKeys.length} API keys`,
      data: {
        apiKeys: allApiKeys,
        total: allApiKeys.length,
      },
    });
  } catch (error: any) {
    console.error("List API keys error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve API keys",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/keys/:id - Get specific API key (admin/superadmin only)
app.get(
  "/:id",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const id = c.req.param("id");

      const [apiKeyData] = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          deviceId: apiKeys.deviceId,
          description: apiKeys.description,
          prefix: apiKeys.prefix,
          permissions: apiKeys.permissions,
          type: apiKeys.type,
          isActive: apiKeys.isActive,
          lastUsed: apiKeys.lastUsed,
          metadata: apiKeys.metadata,
          createdAt: apiKeys.createdAt,
          updatedAt: apiKeys.updatedAt,
          createdBy: {
            id: users.id,
            name: users.name,
            email: users.email,
          },
        })
        .from(apiKeys)
        .leftJoin(users, eq(apiKeys.createdBy, users.id))
        .where(eq(apiKeys.id, id))
        .limit(1);

      if (!apiKeyData) {
        return c.json(
          {
            success: false,
            message: "API key not found",
          },
          404
        );
      }

      return c.json({
        success: true,
        message: "API key retrieved successfully",
        data: {
          apiKey: apiKeyData,
        },
      });
    } catch (error: any) {
      console.error("Get API key error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve API key",
          error: error.message,
        },
        500
      );
    }
  }
);

// DELETE /api/keys/:id - Delete API key (superadmin only)
app.delete("/:id", authMiddleware, requireRole("superadmin"), async (c) => {
  try {
    const db = c.get("db");
    const id = c.req.param("id");

    // Check if API key exists
    const [existingKey] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);

    if (!existingKey) {
      return c.json(
        {
          success: false,
          message: "API key not found",
        },
        404
      );
    }

    // Delete API key
    await db.delete(apiKeys).where(eq(apiKeys.id, id));

    return c.json({
      success: true,
      message: "API key deleted successfully",
      data: {
        deletedKeyId: id,
        name: existingKey.name,
      },
    });
  } catch (error: any) {
    console.error("Delete API key error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to delete API key",
        error: error.message,
      },
      500
    );
  }
});

// PUT /api/keys/:id - Update API key (admin/superadmin only)
app.put(
  "/:id",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const id = c.req.param("id");
      const { name, description, isActive, permissions, metadata } =
        await c.req.json();

      // Check if API key exists
      const [existingKey] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .limit(1);

      if (!existingKey) {
        return c.json(
          {
            success: false,
            message: "API key not found",
          },
          404
        );
      }

      // Build update object
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (permissions !== undefined) updateData.permissions = permissions;
      if (metadata !== undefined) updateData.metadata = metadata;

      // Update API key
      const [updatedKey] = await db
        .update(apiKeys)
        .set(updateData)
        .where(eq(apiKeys.id, id))
        .returning();

      return c.json({
        success: true,
        message: "API key updated successfully",
        data: {
          apiKey: {
            id: updatedKey.id,
            name: updatedKey.name,
            description: updatedKey.description,
            isActive: updatedKey.isActive,
            permissions: updatedKey.permissions,
          },
        },
      });
    } catch (error: any) {
      console.error("Update API key error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to update API key",
          error: error.message,
        },
        500
      );
    }
  }
);

export default app;
