package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
)

type uiFileConfig struct {
	DataDir string `json:"data_dir"`
	HTTP    struct {
		Listen string `json:"listen"`
	} `json:"http"`
	Storage struct {
		Driver string `json:"driver"`
		MySQL  struct {
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Database string `json:"database"`
			Username string `json:"username"`
			Password string `json:"password"`
		} `json:"mysql"`
	} `json:"storage"`
	Bootstrap struct {
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"bootstrap"`
}

func readUIFileConfig(path string) (*uiFileConfig, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open UI config: %w", err)
	}
	defer f.Close()
	var c uiFileConfig
	d := json.NewDecoder(io.LimitReader(f, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return nil, errors.New("invalid UI config JSON or unknown field; check configuration keys and value types")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, errors.New("UI config must contain exactly one JSON object")
	}
	if c.Storage.Driver != "mysql" && c.Storage.Driver != "sqlite" {
		return nil, errors.New("storage.driver must be mysql or sqlite")
	}
	if c.Storage.Driver == "mysql" {
		m := c.Storage.MySQL
		if strings.TrimSpace(m.Host) == "" || strings.TrimSpace(m.Database) == "" || strings.TrimSpace(m.Username) == "" || m.Port < 1 || m.Port > 65535 {
			return nil, errors.New("storage.mysql requires host, port (1..65535), database and username")
		}
	}
	if c.HTTP.Listen != "" {
		_, port, err := net.SplitHostPort(c.HTTP.Listen)
		n, e := strconv.Atoi(port)
		if err != nil || e != nil || n < 1 || n > 65535 {
			return nil, errors.New("http.listen must be host:port with port 1..65535")
		}
	}
	if c.Bootstrap.Password != "" && len(c.Bootstrap.Password) < 8 {
		return nil, errors.New("bootstrap.password must contain at least 8 characters")
	}
	return &c, nil
}

// Export the selected backend to worker processes through their inherited environment.
// Existing env-only deployments remain unchanged when --config is not supplied.
func (c *uiFileConfig) applyEnvironment() error {
	dsn := ""
	if c.Storage.Driver == "mysql" {
		m := c.Storage.MySQL
		cfg := mysql.NewConfig()
		cfg.Net = "tcp"
		cfg.Addr = net.JoinHostPort(m.Host, strconv.Itoa(m.Port))
		cfg.DBName = m.Database
		cfg.User = m.Username
		cfg.Passwd = m.Password
		dsn = cfg.FormatDSN()
	}
	if err := os.Setenv("GOSSIPPER_MYSQL_DSN", dsn); err != nil {
		return err
	}
	if c.Bootstrap.Username != "" {
		if err := os.Setenv("GOSSIPPER_BOOTSTRAP_USERNAME", c.Bootstrap.Username); err != nil {
			return err
		}
	}
	if c.Bootstrap.Password != "" {
		return os.Setenv("GOSSIPPER_BOOTSTRAP_PASSWORD", c.Bootstrap.Password)
	}
	return nil
}
